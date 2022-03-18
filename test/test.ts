import CountTransformer from "../index";
import {
  GraphQLTransform,
  validateModelSchema,
} from "@aws-amplify/graphql-transformer-core";
import * as fs from "fs";
import * as path from "path";
import { parse } from "graphql";
import { countResources, expect as cdkExpect } from "@aws-cdk/assert";
import { ModelTransformer } from "@aws-amplify/graphql-model-transformer";
import Template from "@aws-amplify/graphql-transformer-core/lib/transformation/types";
import {
  makeScanInput,
  primitivesToString,
  notEmptyObject,
  CountResolverEvent,
  DynamoFilter,
} from "../handler";

const test_schema = fs.readFileSync(
  path.resolve(__dirname, "./test_schema.graphql"),
  {
    encoding: "utf-8",
  }
);

const validSchema = `
type Foo @count @model {
    id: ID!
    string_field: String
    int_field: Int
    float_field: Float
    bool_field: Boolean
}
`;

const multiSchema = `
type Foo @count @model {
    id: ID!
    string_field: String
    int_field: Int
    float_field: Float
    bool_field: Boolean
}

type Bar @count @model {
    id: ID!
    string_field: String
    int_field: Int
    float_field: Float
    bool_field: Boolean
}
`;

const makeTransformer = () =>
  new GraphQLTransform({
    transformers: [new CountTransformer(), new ModelTransformer()],
  });

describe("cdk stack", () => {
  test("transformer fails when @model is not used", () => {
    const transformer = makeTransformer();
    expect(() => {
      transformer.transform(`
type Foo @count {
    id: ID!
    string_field: String
    int_field: Int
    float_field: Float
    bool_field: Boolean
}
        `);
    }).toThrow(/model/);
  });

  test("transformer succeeds when @model is used", () => {
    const transformer = makeTransformer();
    const out = transformer.transform(validSchema);
    const parsed = parse(out.schema);
    validateModelSchema(parsed);
  });

  test("resolvers generate successfully", () => {
    const transformer = makeTransformer();
    const out = transformer.transform(validSchema);
    const stack: Template = out.stacks.countResolverStack;

    cdkExpect(stack).to(countResources("AWS::Lambda::Function", 1));
    cdkExpect(stack).to(countResources("AWS::AppSync::DataSource", 1));
    cdkExpect(stack).to(countResources("AWS::AppSync::Resolver", 1));
  });

  test("stack is valid with multiple uses of the directive", () => {
    const transformer = makeTransformer();
    const out = transformer.transform(multiSchema);
    const stack: Template = out.stacks.countResolverStack;

    // Note, this will also check if the stack is valid, ie it will detect if there are duplicate logical IDs
    cdkExpect(stack).to(countResources("AWS::Lambda::Function", 1));
    cdkExpect(stack).to(countResources("AWS::AppSync::DataSource", 1));
    cdkExpect(stack).to(countResources("AWS::AppSync::Resolver", 2));
  });
});

function makeAppSyncEvent(dynamoFilter: DynamoFilter): CountResolverEvent {
  return {
    context: {
      arguments: {
        filter: {},
      },
      identity: null,
      source: null,
      result: null,
      request: { headers: [], domainName: null },
      info: { fieldName: "countFoo", parentTypeName: "Query", variables: {} },
      error: null,
      prev: null,
      stash: {},
      outErrors: [],
    },
    dynamo: dynamoFilter,
    tableName: "Foo-k36yt433bvewbbo5436kmt4ixa-countdev",
  };
}

describe("makeScanInput", () => {
  test("empty properties", () => {
    expect(
      makeScanInput(
        makeAppSyncEvent({
          expression: "",
          expressionNames: {},
          expressionValues: {},
        }),
        undefined
      )
    ).toEqual(
      expect.objectContaining({
        FilterExpression: undefined,
        ExpressionAttributeNames: undefined,
        ExpressionAttributeValues: undefined,
      })
    );
  });

  test("non empty properties", () => {
    expect(
      makeScanInput(
        makeAppSyncEvent({
          expression:
            "((#int_field = :and_0_int_field_eq) AND (attribute_exists(#bool_field)))",
          expressionNames: {
            "#bool_field": "bool_field",
            "#int_field": "int_field",
          },
          expressionValues: { ":and_0_int_field_eq": [{ N: "123" }] },
        }),
        undefined
      )
    ).toEqual(
      expect.objectContaining({
        FilterExpression:
          "((#int_field = :and_0_int_field_eq) AND (attribute_exists(#bool_field)))",
        ExpressionAttributeNames: {
          "#bool_field": "bool_field",
          "#int_field": "int_field",
        },
        ExpressionAttributeValues: { ":and_0_int_field_eq": [{ N: "123" }] },
      })
    );
  });

  test("filter expression with names but no values", () => {
    expect(
      makeScanInput(
        makeAppSyncEvent({
          expression: "(attribute_exists(#int_field))",
          expressionNames: { "#int_field": "int_field" },
          expressionValues: {},
        }),
        undefined
      )
    ).toEqual(
      expect.objectContaining({
        FilterExpression: "(attribute_exists(#int_field))",
        ExpressionAttributeNames: { "#int_field": "int_field" },
        ExpressionAttributeValues: undefined,
      })
    );
  });
});

test("notEmptyObject", () => {
  expect(notEmptyObject(1)).toEqual(false);
  expect(notEmptyObject(undefined)).toEqual(false);
  expect(notEmptyObject(null)).toEqual(false);
  expect(notEmptyObject({})).toEqual(false);
  expect(notEmptyObject({ a: 1 })).toEqual(true);
  expect(notEmptyObject([])).toEqual(false);
});

test("primitivesToString", () => {
  expect(primitivesToString(true)).toEqual("true");
  expect(primitivesToString("foo")).toEqual("foo");
  expect(primitivesToString(123)).toEqual("123");
  expect(primitivesToString([1, 2, 3])).toEqual(["1", "2", "3"]);
  expect(primitivesToString({ a: { b: { c: 3 } } })).toEqual({
    a: { b: { c: "3" } },
  });
});
