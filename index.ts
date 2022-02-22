// import {MappingTemplate, TransformerPluginBase} from "@aws-amplify/graphql-transformer-core";
import {MappingTemplate, TransformerNestedStack} from "@aws-amplify/graphql-transformer-core";
import {TransformerPluginBase} from "@aws-amplify/graphql-transformer-core"
import {
    TransformerContextProvider,
    TransformerPluginProvider,
    TransformerSchemaVisitStepContextProvider,
    TransformerTransformSchemaStepContextProvider
} from "@aws-amplify/graphql-transformer-interfaces"
import {
    makeField,
    makeInputValueDefinition,
    makeNamedType,
    toCamelCase,
    toPascalCase,
} from 'graphql-transformer-common';
import {DirectiveNode, FieldDefinitionNode, ObjectTypeDefinitionNode} from "graphql";
import * as lambda_node from "@aws-cdk/aws-lambda-nodejs";
import * as lambda from "@aws-cdk/aws-lambda";
import * as cdk from "@aws-cdk/core"
import {calculateFunctionHash} from "@aws-cdk/aws-lambda/lib/function-hash"
import {
    and,
    bool,
    compoundExpression,
    equals,
    ifElse,
    iff,
    int,
    isNullOrEmpty,
    methodCall,
    not,
    obj,
    printBlock,
    qref,
    raw,
    ref,
    set,
    str,
    toJson
} from 'graphql-mapping-template';
import * as path from "path";
import {StackManager} from "@aws-amplify/graphql-transformer-core/lib/transformer-context/stack-manager";
import {ResourceConstants} from 'graphql-transformer-common';
import {Fn, AssetStaging, Stage} from "@aws-cdk/core";
import {Bundling} from "@aws-cdk/aws-lambda-nodejs/lib/bundling"
import {Asset} from "@aws-cdk/aws-s3-assets";
import {S3MappingFunctionCode} from "@aws-amplify/graphql-transformer-core/lib/cdk-compat/template-asset";
import {TransformerStackSythesizer} from "@aws-amplify/graphql-transformer-core/lib/cdk-compat";


export default class CountTransformer extends TransformerPluginBase implements TransformerPluginProvider {
    private models: ObjectTypeDefinitionNode[];

    constructor() {
        super("count", "directive @count on OBJECT");
        this.models = [];
    }

    object = (definition: ObjectTypeDefinitionNode, directive: DirectiveNode, ctx: TransformerSchemaVisitStepContextProvider) => {
        // Keep track of everything annotated with @count
        this.models.push(definition);
    }

    transformSchema = (ctx: TransformerTransformSchemaStepContextProvider) => {
        const fields: FieldDefinitionNode[] = [];

        // For each model that has been annotated with @count
        for (const model of this.models) {
            if (!model.directives?.find(dir => dir.name.value === "model")) {
                throw new Error("Any type annotated with @count must also be annotated with @model, as it re-uses types from that directive.");
            }
            // The top level field inside Query
            const queryName = toCamelCase(['count', model.name.value]);
            // The name of the filter argument to count()
            const filterInputName = toPascalCase(['Model', model.name.value, 'FilterInput']);

            // Make the actual Query field
            // e.g. countHits(filter: ModelHitFilterInput): Int
            fields.push(makeField(
                queryName,
                [
                    makeInputValueDefinition('filter', makeNamedType(filterInputName)),
                ],
                makeNamedType("Int")
            ));
        }

        ctx.output.addQueryFields(fields);
    };

    generateResolvers = (ctx: TransformerContextProvider) => {

        // Path on the local filesystem to the handler zip file
        const HANDLER_LOCAL_PATH = path.join(__dirname, 'handler/handler.zip');

        const stack: TransformerNestedStack = ctx.stackManager.createStack("countResolverStack") as TransformerNestedStack;
        stack.setParameter(ResourceConstants.PARAMETERS.S3DeploymentBucket, Fn.ref(ResourceConstants.PARAMETERS.S3DeploymentBucket));
        stack.setParameter(ResourceConstants.PARAMETERS.S3DeploymentRootKey, Fn.ref(ResourceConstants.PARAMETERS.S3DeploymentRootKey));

        const func = new lambda.Function(stack, "countResolver", {
            code: lambda.Code.fromAsset(HANDLER_LOCAL_PATH),
            handler: "handler",
            runtime: lambda.Runtime.NODEJS_14_X
        });
        // Path in S3 (relative to the root key) to the handler zip
        // We can't use CDK bundling because amplify uses a very fragile custom Synthesizer
        const HANDLER_S3_PATH = `functions/${func.node.id}.zip`;
        const code = (func.node.defaultChild as lambda.CfnFunction).code as lambda.CfnFunction.CodeProperty;
        //@ts-ignore
        code.s3Key = `${Fn.ref(ResourceConstants.PARAMETERS.S3DeploymentRootKey)}/${HANDLER_S3_PATH}`;
        // const split = code.s3Key?.split('/') || [];
        // if (split.length == 2) {
        //     const key = split[0];
        //     //@ts-ignore
        //     code.s3Key = `${key}/${HANDLER_S3_PATH}`;
        // }

        // Register the handler asset
        (stack.synthesizer as TransformerStackSythesizer).setMappingTemplates(HANDLER_S3_PATH, HANDLER_LOCAL_PATH);

        const dataSource = ctx.api.host.addLambdaDataSource(
            `countResolverDataSource`,
            func,
            {},
            stack
        );
        const requestVariable = 'ListRequest';
        const modelQueryObj = 'ctx.stash.modelQueryExpression';
        const indexNameVariable = 'ctx.stash.metadata.index';

        for (const model of this.models) {
            const resolver = ctx.api.host.addResolver(
                'Query',
                toCamelCase(['count', model.name.value]),
                MappingTemplate.s
                    printBlock(`Invoke AWS Lambda data source: ${dataSource.node.id}`)(
                        obj({
                            version: str('2018-05-29'),
                            operation: str('Invoke'),
                            payload: obj({
                                typeName: ref('util.toJson($ctx.stash.get("typeName"))'),
                                fieldName: ref('util.toJson($ctx.stash.get("fieldName"))'),
                                arguments: ref('util.toJson($ctx.arguments)'),
                                identity: ref('util.toJson($ctx.identity)'),
                                source: ref('util.toJson($ctx.source)'),
                                request: ref('util.toJson($ctx.request)'),
                                prev: ref('util.toJson($ctx.prev)'),
                                dynamo: compoundExpression([
                                    iff(
                                        not(isNullOrEmpty(ref('filter'))),
                                        compoundExpression([
                                            set(
                                                ref(`filterExpression`),
                                                methodCall(ref('util.parseJson'), methodCall(ref('util.transform.toDynamoDBFilterExpression'), ref('filter'))),
                                            ),
                                            iff(
                                                not(methodCall(ref('util.isNullOrBlank'), ref('filterExpression.expression'))),
                                                compoundExpression([
                                                    iff(
                                                        equals(methodCall(ref('filterExpression.expressionValues.size')), int(0)),
                                                        qref(methodCall(ref('filterExpression.remove'), str('expressionValues'))),
                                                    ),
                                                    set(ref(`${requestVariable}.filter`), ref(`filterExpression`)),
                                                ]),
                                            ),
                                        ]),
                                    ),
                                    ifElse(
                                        and([
                                            not(methodCall(ref('util.isNull'), ref(modelQueryObj))),
                                            not(methodCall(ref('util.isNullOrEmpty'), ref(`${modelQueryObj}.expression`))),
                                        ]),
                                        compoundExpression([
                                            qref(methodCall(ref(`${requestVariable}.put`), str('operation'), str('Query'))),
                                            qref(methodCall(ref(`${requestVariable}.put`), str('query'), ref(modelQueryObj))),
                                            ifElse(
                                                and([not(methodCall(ref('util.isNull'), ref('args.sortDirection'))), equals(ref('args.sortDirection'), str('DESC'))]),
                                                set(ref(`${requestVariable}.scanIndexForward`), bool(false)),
                                                set(ref(`${requestVariable}.scanIndexForward`), bool(true)),
                                            ),
                                        ]),
                                        qref(methodCall(ref(`${requestVariable}.put`), str('operation'), str('Scan'))),
                                    ),
                                    iff(not(methodCall(ref('util.isNull'), ref(indexNameVariable))), set(ref(`${requestVariable}.IndexName`), ref(indexNameVariable))),
                                    toJson(ref(requestVariable)),
                                ])
                            }),
                        }),
                    ),
                ),
                MappingTemplate.inlineTemplateFromString(
                    printBlock('Handle error or return result')(
                        compoundExpression([
                            iff(ref('ctx.error'), raw('$util.error($ctx.error.message, $ctx.error.type)')),
                            raw('$util.toJson($ctx.result)'),
                        ]),
                    ),
                ),
                undefined,
                undefined,
                [],
                stack,
            );
        }
    };
}