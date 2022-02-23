# AmplifyCountDirective

AmplifyCountDirective provides the ability to count the number of items in your DynamoDB tables using Amplify.

## Example

This package provides the `@count` directive which can be used to annotate your models.
Let's say we use it in the following schema:
```graphql
type Foo @count @model {
  id: ID!
  string_field: String
  int_field: Int
  float_field: Float
  bool_field: Boolean
}
```

This will compile into:
```graphql
type Query {
    getFoo(id: ID!): Foo
    listFoos(filter: ModelFooFilterInput, limit: Int, nextToken: String): ModelFooConnection
    countFoo(filter: ModelFooFilterInput): Int
}
```

Finally you can query the number of items in your table using the same filters as you would use to list them:
```graphql
{
  countFoo(filter: {
      and: {
          bool_field: {eq: false},
          float_field: {le: 1.5},
          string_field: {contains: "bar"}
      }
  })
}
```

## Usage

1. Install this module using `npm install -g amplify-count-directive`
2. Include the transformer in your amplify application by editing your `amplify/backend/api/<API_NAME>/transform.conf.json`
    ```diff
    {
        "Version": 5,
        "ElasticsearchWarning": true,
        "transformers": [
    +        "amplify-count-directive"
        ]
    }
    ```
3. Add `@count` to your model:
```diff
-type Foo @model {
+type Foo @count @model {
    id: ID!
    string_field: String
    int_field: Int
    float_field: Float
    bool_field: Boolean
}
```

4. Deploy your application using `amplify push`
5. (Optional) Regenerate your JavaScript/TypeScript query templates using `amplify codegen`

## FAQs

### Are you sure Amplify doesn't already offer this capability?

Yep. Take a look at [this long thread](https://github.com/aws-amplify/amplify-cli/issues/1865) where users complain about this fact.
The `count` and `scannedCount` attributes returned when you `listFoo` only apply to each page of data individually, so are not helpful.
You can use the `@searchable` directive to obtain some aggregation capabilities, but it's not cheap and the cost scales very poorly.

### How much will this add to my AWS bill?

Ideally nothing. 
The AppSync resolvers are totally free to run, and only the Lambda function might end up costing you.
However this package only uses the smallest size lambda, so it's realistically going to be free.
It does however fire a few calls off to the DynamoDB table, so this might end up costing you a few cents, if you pay on demand.

### Do I have to install this globally?

No you don't, but it's recommended that you do, because the Amplify CLI itself needs to be installed globally.
You can just `npm install amplify-count-directive` in the root directory of your application, and it should work.
However you run into some risks of the deployment breaking when it uses different copies (global and local) of the same libraries.
Refer to [this GitHub issue](https://github.com/aws-amplify/amplify-cli/issues/9362) for more information.

### How fast is the count process?

It's noticeably slower than listing a single page of results, which is what you get when you query `listFoo`.
This happens because `countFoo` uses a Lambda function, which can take a few seconds to spin up.
In addition, it has to actually churn through all the data in the table, even though it's just counting it.
In theory this could be optimised using GSIs (indexes), but this hasn't yet been implemented.
I therefore recommend you fire off the count query ASAP when your app loads, and start showing the first page of table data even before the count has returned.

### Why couldn't you use AppSync VTL resolvers to do this?

AppSync is strange.
VTL looks like a programming language, but it's really just a templating language, and it doesn't have the ability to call the AWS API directly.
Instead you have to return a query template which will run a single API call.
This means that it can't count the number of items in a table, because this requires multiple successive `Scan` calls to the DynamoDB table.
This is a bit unfortunate, because VTL resolvers are much faster, but that's just the way it is.

### Why didn't you nest the count resolver inside the listFoo query?

If you try to access `listFoo{ count }`, it will fire off a resolver for `listFoo`, which isn't actually needed when you are counting table entries, so this would be a waste.
This option is therefore more efficient.

### Can I help with this?

Sure! Please do. You can find the GitHub issues [here](https://github.com/multimeric/AmplifyCountDirective/issues).
Please let me know if you want to work on one and I can assign it to you.