import {AppSyncResolverEvent} from "aws-lambda"
import {DynamoDB} from "@aws-sdk/client-dynamodb";
import {ScanCommandOutput} from "@aws-sdk/lib-dynamodb";

export const handler = async (event: AppSyncResolverEvent<any, any>) => {
    console.log(JSON.stringify(event));
    console.log(JSON.stringify(process.env));
    const dbClient = new DynamoDB({});

    let count = 0;
    let startKey = undefined;
    while(true) {
        const res: ScanCommandOutput = await dbClient.scan({
            Select: "COUNT",
            TableName: process.env.API_HYDDBAMPLIFY_HITTABLE_NAME,
            ExclusiveStartKey: startKey,
        });
        count += res.Count || 0;

        // Keep looping if there is more data
        if (res.LastEvaluatedKey) {
            startKey = res.LastEvaluatedKey
        }
        else {
            break
        }
    }

    return count;
};
