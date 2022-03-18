import {
  TransformerNestedStack,
  TransformerPluginBase,
} from "@aws-amplify/graphql-transformer-core";
import {
  TransformerContextProvider,
  TransformerPluginProvider,
  TransformerSchemaVisitStepContextProvider,
  TransformerTransformSchemaStepContextProvider,
} from "@aws-amplify/graphql-transformer-interfaces";
import {
  makeField,
  makeInputValueDefinition,
  makeNamedType,
  toCamelCase,
  toPascalCase,
} from "graphql-transformer-common";
import {
  DirectiveNode,
  FieldDefinitionNode,
  ObjectTypeDefinitionNode,
} from "graphql";
import * as lambda from "@aws-cdk/aws-lambda";
import * as path from "path";
import * as appsync from "@aws-cdk/aws-appsync";
import * as iam from "@aws-cdk/aws-iam";

export default class CountTransformer
  extends TransformerPluginBase
  implements TransformerPluginProvider
{
  models: ObjectTypeDefinitionNode[];

  constructor() {
    super("count", "directive @count on OBJECT");
    this.models = [];
  }

  object = (
    definition: ObjectTypeDefinitionNode,
    directive: DirectiveNode,
    ctx: TransformerSchemaVisitStepContextProvider
  ) => {
    // Keep track of everything annotated with @count
    this.models.push(definition);
  };

  transformSchema = (ctx: TransformerTransformSchemaStepContextProvider) => {
    const fields: FieldDefinitionNode[] = [];

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
