const { S3 } = require("@aws-sdk/client-s3");
const sharp = require("sharp");

const awsRegion = "eu-west-2";
const s3 = new S3({ region: awsRegion });

const resizedFolder = "resized";

// read stream to buffer
async function streamToBuffer(stream) {
    return new Promise(async (resolve, reject) => {
        try {
            const chunks = []

            stream.on('data', chunk => chunks.push(chunk))
            stream.once('end', () => resolve(Buffer.concat(chunks)))
            stream.once('error', reject)
        } catch (err) {
            reject(err)
        }
    });
}

exports.handler = async (event, context) => {
    console.log(`Event: ${JSON.stringify(event, null, 2)}`);
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);

    try {
        const bucket = event.Records[0].s3.bucket.name;
        const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

        const { Body, ContentType, Metadata } =
            await s3.getObject({ Bucket: bucket, Key: key });

        if (ContentType && ContentType.startsWith("image") && key.startsWith("assessment-")) {
            const img = await streamToBuffer(Body);
            const resizedKey = `${resizedFolder}/${key}`;
            const contentType = "image/png";
            const resizedWidth = 500;

            const resizedImgBuffer = await sharp(img).resize({ width: resizedWidth }).png().toBuffer();

            await s3.putObject({
                Bucket: bucket,
                Key: resizedKey,
                Body: resizedImgBuffer,
                ContentType: contentType,
                Metadata: { ...(Metadata || {}), width: `${resizedWidth}` }
            });
        }
    } catch (err) {
        console.error(err);
    }

    const response = {
        statusCode: 200,
        body: JSON.stringify('Ok'),
    };

    return response;
};
