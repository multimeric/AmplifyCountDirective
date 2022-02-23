import {DynamoDB} from "@aws-sdk/client-dynamodb";
import {ScanCommandOutput} from "@aws-sdk/lib-dynamodb";

// Refer to ../test/handler_context.json for an example
interface CountResolverEvent {
    context: any
    dynamo: DynamoFilter
    tableName: string
}

interface Context {
    info: Info
}

interface Info {
    fieldName: string
    parentTypeName: string
    variables: any
}

interface DynamoFilter {
    expression: string
    expressionNames: Record<string, string>
    expressionValues: Record<string, any>
}

function primitivesToString(input: any): any {
    if (typeof input === "object") {
        if (Array.isArray(input)) {
            return input.map(primitivesToString);
        } else {
            return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, primitivesToString(value)]))
        }
    }
    return String(input);
}

export const handler = async (event: CountResolverEvent) => {
    const dbClient = new DynamoDB({});

    let count = 0;
    let startKey = undefined;
    while (true) {
        const res: ScanCommandOutput = await dbClient.scan({
            Select: "COUNT",
            TableName: event.tableName,
            ExclusiveStartKey: startKey,
            FilterExpression: event.dynamo.expression,
            ExpressionAttributeNames: event.dynamo.expressionNames,
            ExpressionAttributeValues: primitivesToString(event.dynamo.expressionValues)
        });
        count += res.Count || 0;

        // Keep looping if there is more data
        if (res.LastEvaluatedKey) {
            startKey = res.LastEvaluatedKey
        } else {
            break
        }
    }

    return count;
};
