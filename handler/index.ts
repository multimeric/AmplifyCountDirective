import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { ScanCommandInput, ScanCommandOutput } from "@aws-sdk/lib-dynamodb";
import makeDebug from "debug";

const debug = makeDebug("handler");

// Refer to ../test/handler_context.json for an example
export interface CountResolverEvent {
  context: any;
  dynamo: DynamoFilter | null;
  tableName: string;
}

interface Context {
  info: Info;
}

interface Info {
  fieldName: string;
  parentTypeName: string;
  variables: any;
}

export interface DynamoFilter {
  expression: string;
  expressionNames: Record<string, string>;
  expressionValues: Record<string, any>;
}

/**
 * Recursively converts objects to strings. If the input is a primitive, it calls String on it, otherwise
 * it recurses over the object or array items
 */
export function primitivesToString<T>(input: any): any {
  if (typeof input === "object") {
    if (Array.isArray(input)) {
      return input.map(primitivesToString);
    } else {
      return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          primitivesToString(value),
        ])
      );
    }
  }
  return String(input);
}

/**
 * Returns true if the argument is an object that has at least 1 key
 */
export function notEmptyObject(obj: any): boolean {
  if (typeof obj === "object" && obj !== null) {
    return Object.keys(obj).length > 0;
  }
  return false;
}

export function makeScanInput(
  event: CountResolverEvent,
  startKey: ScanCommandInput["ExclusiveStartKey"]
): ScanCommandInput {
  return {
    Select: "COUNT",
    TableName: event.tableName,
    ExclusiveStartKey: startKey,
    FilterExpression:
      event.dynamo && event.dynamo.expression.length > 0
        ? event.dynamo?.expression
        : undefined,
    ExpressionAttributeNames: notEmptyObject(event.dynamo?.expressionNames)
      ? event.dynamo?.expressionNames
      : undefined,
    ExpressionAttributeValues: notEmptyObject(event.dynamo?.expressionValues)
      ? primitivesToString(event.dynamo?.expressionValues)
      : undefined,
  };
}

export const handler = async (event: CountResolverEvent) => {
  debug("Incoming event data from AppSync: %o", event);
  const dbClient = new DynamoDB({});

  let count = 0;
  let startKey = undefined;
  while (true) {
    const scanArgs = makeScanInput(event, startKey);
    debug("Executing the following Dynamo scan: %o", scanArgs);
    const res: ScanCommandOutput = await dbClient.scan(scanArgs);
    count += res.Count || 0;

    // Keep looping if there is more data
    if (res.LastEvaluatedKey) {
      startKey = res.LastEvaluatedKey;
    } else {
      break;
    }
  }

  return count;
};
