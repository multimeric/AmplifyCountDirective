import {TransformerModelBase, TransformerPluginBase} from "@aws-amplify/graphql-transformer-core";
import {
    QueryFieldType,
    TransformerContextProvider,
    TransformerModelProvider, TransformerPluginProvider,
    TransformerSchemaVisitStepContextProvider,
    TransformerTransformSchemaStepContextProvider
} from "@aws-amplify/graphql-transformer-interfaces"
import {ModelTransformer} from "@aws-amplify/graphql-model-transformer"
import {
    getBaseType,
    isScalar,
    makeArgument,
    makeDirective,
    makeField,
    makeInputValueDefinition,
    makeNamedType,
    makeNonNullType,
    makeValueNode,
    ModelResourceIDs,
    ResolverResourceIDs,
    ResourceConstants,
    SyncResourceIDs,
    toCamelCase,
    toPascalCase,
} from 'graphql-transformer-common';
import {
    addDirectivesToOperation,
    addModelConditionInputs,
    createEnumModelFilters,
    extendTypeWithDirectives,
    makeCreateInputField,
    makeDeleteInputField,
    makeListQueryFilterInput,
    makeListQueryModel,
    makeModelSortDirectionEnumObject,
    makeMutationConditionInput,
    makeUpdateInputField,
    propagateApiKeyToNestedTypes,
} from '@aws-amplify/graphql-model-transformer';
import {DirectiveNode, FieldDefinitionNode, ObjectTypeDefinitionNode} from "graphql";

export class CountTransformer extends TransformerPluginBase implements TransformerPluginProvider  {
    private models: ObjectTypeDefinitionNode[];
    constructor() {
        super("count", "directive @count on OBJECT");
        this.models = [];
    }
    object = (definition: ObjectTypeDefinitionNode, directive: DirectiveNode, ctx: TransformerSchemaVisitStepContextProvider) => {
        this.models.push(definition);
    }
    transformSchema = (ctx: TransformerTransformSchemaStepContextProvider) => {
        const fields: FieldDefinitionNode[] = [];

        // For each model that has been annotated with @count
        for (const model of this.models) {
            // The top level field inside Query
            const queryName = toCamelCase(['count', model.name.value]);
            // The name of the filter argument to count()
            const filterInputName = toPascalCase(['Model', model.name.value, 'FilterInput']);

            // The arguments to the FilterInput
            const filterInputs = createEnumModelFilters(ctx, model);
            filterInputs.push(makeListQueryFilterInput(ctx, filterInputName, model));
            for (let input of filterInputs) {
                const conditionInputName = input.name.value;
                if (!ctx.output.getType(conditionInputName)) {
                    ctx.output.addInput(input);
                }
            }

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
        // TODO
    };
}