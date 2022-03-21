import {
  DirectiveWrapper,
  TransformerNestedStack,
  TransformerPluginBase,
} from "@aws-amplify/graphql-transformer-core";
import {
  TransformerContextProvider,
  TransformerPluginProvider,
  TransformerSchemaVisitStepContextProvider,
  TransformerTransformSchemaStepContextProvider,
} from "@aws-amplify/graphql-transformer-interfaces";
import * as appsync from "@aws-cdk/aws-appsync";
import * as iam from "@aws-cdk/aws-iam";
import * as lambda from "@aws-cdk/aws-lambda";
import {
  DirectiveNode,
  FieldDefinitionNode,
  InterfaceTypeDefinitionNode,
  Kind,
  ListTypeNode,
  NamedTypeNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  TypeNode,
} from "graphql";
import {
  getBaseType,
  makeField,
  makeInputValueDefinition,
  makeNamedType,
  ResolverResourceIDs,
  toCamelCase,
  toPascalCase,
} from "graphql-transformer-common";
import * as path from "path";

export function getCountAttributeName(type: string, field: string) {
  return toCamelCase([type, field, "id"]);
}

export interface FieldCountDirectiveConfiguration {
  directiveName: string;
  object: ObjectTypeDefinitionNode;
  field: FieldDefinitionNode;
  directive: DirectiveNode;
  countObject: ObjectTypeDefinitionNode;
  countField: string;
  countNode: FieldDefinitionNode;
  resolverTypeName: string;
  resolverFieldName: string;
}

const directiveName = "fieldCount";

export default class CountTransformer
  extends TransformerPluginBase
  implements TransformerPluginProvider
{
  models: ObjectTypeDefinitionNode[];
  fields: FieldCountDirectiveConfiguration[];

  constructor() {
    super(
      "count",
      `
    directive @count(type: CountType!) on OBJECT
    directive @${directiveName}(type: CountType!, countField: String) on FIELD_DEFINITION
    enum CountType {
      scan
      distinct
    }
`
    );
    this.models = [];
    this.fields = [];
  }

  field = (
    parent: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode,
    field: FieldDefinitionNode,
    directive: DirectiveNode,
    context: TransformerSchemaVisitStepContextProvider
  ) => {
    const directiveWrapped = new DirectiveWrapper(directive);
    const args = directiveWrapped.getArguments({
      directiveName,
      object: parent as ObjectTypeDefinitionNode,
      field: field,
      resolverTypeName: parent.name.value,
      resolverFieldName: field.name.value,
      directive,
    }) as FieldCountDirectiveConfiguration;

    /// Keep track of all fields annotated with @count
    validate(args, context as TransformerContextProvider);
    this.fields.push(args);
  };

  object = (
    definition: ObjectTypeDefinitionNode,
    directive: DirectiveNode,
    ctx: TransformerSchemaVisitStepContextProvider
  ) => {
    // Keep track of everything annotated with @count
    this.models.push(definition);
  };

  transformSchema = (ctx: TransformerTransformSchemaStepContextProvider) => {
    const context = ctx as TransformerContextProvider;

    const fields: FieldDefinitionNode[] = [];

    // For each field that has been annotated with @count
    for (const config of this.fields) {
      ensureHasCountField(config, context);
    }

    // For each model that has been annotated with @count
    for (const model of this.models) {
      if (!model.directives?.find((dir) => dir.name.value === "model")) {
        throw new Error(
          "Any type annotated with @count must also be annotated with @model, as it re-uses types from that directive."
        );
      }
      // The top level field inside Query
      const queryName = toCamelCase(["count", model.name.value]);
      // The name of the filter argument to count()
      const filterInputName = toPascalCase([
        "Model",
        model.name.value,
        "FilterInput",
      ]);

      // Make the actual Query field
      // e.g. countHits(filter: ModelHitFilterInput): Int
      fields.push(
        makeField(
          queryName,
          [makeInputValueDefinition("filter", makeNamedType(filterInputName))],
          makeNamedType("Int")
        )
      );
    }

    ctx.output.addQueryFields(fields);
  };

  generateResolvers = (ctx: TransformerContextProvider) => {
    const createdResources = new Map<string, any>();

    // Path on the local filesystem to the handler zip file
    const HANDLER_LOCAL_PATH = path.join(__dirname, "handler.zip");
    const stack: TransformerNestedStack = ctx.stackManager.createStack(
      "countResolverStack"
    ) as TransformerNestedStack;
    const funcId = "countResolverFunc";
    const HANDLER_S3_PATH = `functions/${funcId}.zip`;

    // Create the resolver function. This can be shared across all tables since it receives a different payload
    // for each table
    const funcRole = new iam.Role(stack, `${funcId}LambdaRole`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    const func = ctx.api.host.addLambdaFunction(
      "countResolver",
      HANDLER_S3_PATH,
      "index.handler",
      HANDLER_LOCAL_PATH,
      lambda.Runtime.NODEJS_14_X,
      undefined, // layers
      funcRole, // execution role,
      undefined, // env vars
      undefined, // lambda timeout
      stack
    );
    funcRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    // Make this lambda into a data source
    const dataSource = ctx.api.host.addLambdaDataSource(
      `countResolverDataSource`,
      func,
      {},
      stack
    );

    for (const config of this.fields) {
      const {
        field,
        countField,
        object,
        resolverTypeName,
        resolverFieldName,
        countObject,
      } = config;

      // Find the table we want to scan
      const tableDataSource = ctx.dataSources.get(
        countObject
      ) as appsync.DynamoDbDataSource;
      const table = tableDataSource.ds
        .dynamoDbConfig as appsync.CfnDataSource.DynamoDBConfigProperty;

      // Allow the lambda to access this table
      funcRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["dynamodb:Scan"],
          effect: iam.Effect.ALLOW,
          resources: [
            `arn:aws:dynamodb:${table.awsRegion}:${stack.account}:table/${table.tableName}`,
          ],
        })
      );

      // Create the GraphQL resolvers.
      const resolverId = ResolverResourceIDs.ResolverResourceID(
        config.resolverTypeName,
        config.countField
      );
      let resolver = createdResources.get(resolverId);

      if (resolver === undefined) {
        // TODO: update function to use resolver manager
        resolver = new appsync.CfnResolver(
          stack,
          `${field.name.value}${object.name.value}CountResolver`,
          {
            apiId: ctx.api.apiId,
            fieldName: config.countField,
            typeName: config.resolverTypeName,
            kind: "UNIT",
            requestMappingTemplate: `
$util.toJson({
  "version": "2018-05-29",
  "operation": "Invoke",
  "payload": {
      "context": $ctx,
      "dynamo": $util.parseJson($util.transform.toDynamoDBFilterExpression($ctx.arguments.filter)),
      "tableName": "${table.tableName}"
  }
})
                `,
            responseMappingTemplate: `
#if( $ctx.error )
    $util.error($ctx.error.message, $ctx.error.type)
#else
    $util.toJson($ctx.result)
    ${config.resolverTypeName}.${config.countField}.res.vtl
#end
`,
          }
        );

        createdResources.set(resolverId, resolver);
      }

      resolver.pipelineConfig.functions.push(func);
    }

    for (const model of this.models) {
      // Find the table we want to scan
      const tableDataSource = ctx.dataSources.get(
        model
      ) as appsync.DynamoDbDataSource;
      const table = tableDataSource.ds
        .dynamoDbConfig as appsync.CfnDataSource.DynamoDBConfigProperty;

      // Allow the lambda to access this table
      funcRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["dynamodb:Scan"],
          effect: iam.Effect.ALLOW,
          resources: [
            `arn:aws:dynamodb:${table.awsRegion}:${stack.account}:table/${table.tableName}`,
          ],
        })
      );

      // Connect the resolver to the API
      const resolver = new appsync.CfnResolver(
        stack,
        `${model.name.value}CountResolver`,
        {
          apiId: ctx.api.apiId,
          fieldName: toCamelCase(["count", model.name.value]),
          typeName: "Query",
          kind: "UNIT",
          dataSourceName: dataSource?.ds.attrName,
          requestMappingTemplate: `
$util.toJson({
  "version": "2018-05-29",
  "operation": "Invoke",
  "payload": {
      "context": $ctx,
      "dynamo": $util.parseJson($util.transform.toDynamoDBFilterExpression($ctx.arguments.filter)),
      "tableName": "${table.tableName}"
  }
})
                `,
          responseMappingTemplate: `
#if( $ctx.error )
    $util.error($ctx.error.message, $ctx.error.type)
#else
    $util.toJson($ctx.result)
#end
`,
        }
      );

      // resolver.overrideLogicalId(resourceId);
      ctx.api.addSchemaDependency(resolver);
    }
  };
}

export function ensureHasCountField(
  config: FieldCountDirectiveConfiguration,
  ctx: TransformerContextProvider
) {
  const { field, countNode, object } = config;

  // If fields were explicitly provided to the directive, there is nothing else to do here.
  if (countNode) {
    return;
  }

  const countAttributeName = getCountAttributeName(
    object.name.value,
    field.name.value
  );

  const typeObject = ctx.output.getType(
    object.name.value
  ) as ObjectTypeDefinitionNode;

  if (typeObject) {
    const updated = updateTypeWithCountField(typeObject, countAttributeName);
    ctx.output.putType(updated);
  }

  config.countField = countAttributeName;
}

export function isNonNullType(type: TypeNode): boolean {
  return type.kind === Kind.NON_NULL_TYPE;
}

function updateTypeWithCountField(
  object: ObjectTypeDefinitionNode,
  countFieldName: string
): ObjectTypeDefinitionNode {
  const keyFieldExists = object.fields!.some(
    (f) => f.name.value === countFieldName
  );

  // If the key field already exists then do not change the input.
  if (keyFieldExists) {
    return object;
  }

  // Create a name for the filter key
  const filterInputName = toPascalCase([
    "Model",
    countFieldName,
    "FilterInput",
  ]);

  // Add the new field to the original model
  const updatedFields = [
    ...object.fields!,
    makeField(
      countFieldName,
      [makeInputValueDefinition("filter", makeNamedType(filterInputName))],
      makeNonNullType(makeNamedType("Int")),
      []
    ),
  ];

  return {
    ...object,
    fields: updatedFields,
  };
}

export function makeNonNullType(
  type: NamedTypeNode | ListTypeNode
): NonNullTypeNode {
  return {
    kind: Kind.NON_NULL_TYPE,
    type,
  };
}

function validate(
  config: FieldCountDirectiveConfiguration,
  ctx: TransformerContextProvider
): void {
  const { field } = config;

  validateIndexDirective(config);

  if (!isListType(field.type)) {
    throw new Error(`@${directiveName} cannot be used on non-lists.`);
  }

  config.countNode = getCountNode(config, ctx);
  config.countObject = getCountTableType(config, ctx);
}

export function validateIndexDirective(
  config: FieldCountDirectiveConfiguration
) {
  if (
    !config.field.directives?.find((dir) => dir.name.value === "hasMany") ||
    !config.field.directives?.find((dir) => dir.name.value === "manyToMany")
  ) {
    throw new Error(
      `Any field annotated with @${config.directiveName} must also be annoted with @hasMany or @manyToMany, as it uses their connecting tables for count.`
    );
  }

  if (!getModelDirective(config.object)) {
    throw new Error(
      `@${config.directiveName} must be on an @model object type field.`
    );
  }
}
export function getModelDirective(objectType: ObjectTypeDefinitionNode) {
  return objectType.directives!.find((directive) => {
    return directive.name.value === "model";
  });
}

export function isListType(type: TypeNode): boolean {
  if (type.kind === Kind.NON_NULL_TYPE) {
    return isListType(type.type);
  } else if (type.kind === Kind.LIST_TYPE) {
    return true;
  } else {
    return false;
  }
}

export function getCountNode(
  config: FieldCountDirectiveConfiguration,
  ctx: TransformerContextProvider
) {
  const { countField, object } = config;

  const fieldNode = object.fields!.find(
    (objectField) => objectField.name.value === countField
  );

  if (!fieldNode) {
    throw new Error(`${countField} is not a field in ${object.name.value}`);
  }

  return fieldNode;
}

export function getCountTableType(
  config: FieldCountDirectiveConfiguration,
  ctx: TransformerContextProvider
) {
  const { field } = config;
  const countFieldTypeName = getBaseType(field.type);
  const countFieldType = ctx.inputDocument.definitions.find(
    (d: any) =>
      d.kind === Kind.OBJECT_TYPE_DEFINITION &&
      d.name.value === countFieldTypeName
  ) as ObjectTypeDefinitionNode | undefined;

  if (!countFieldType) {
    throw Error(`Unknown type name on field directive`);
  }

  return countFieldType;
}
