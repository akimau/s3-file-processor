const { S3 } = require("@aws-sdk/client-s3");
const axios = require("axios");
const sharp = require("sharp");
const pdfJsLib = require("pdfjs-dist");
const NodeCanvasFactory = require("./nodeCanvas");

const s3 = new S3({ region: "us-east-1" });

// Some PDFs need external cmaps.
const CMAP_URL = "./node_modules/pdfjs-dist/cmaps/";
const CMAP_PACKED = true;

// Where the standard fonts are located.
const STANDARD_FONT_DATA_URL =
    "./node_modules/pdfjs-dist/standard_fonts/";

const canvasFactory = new NodeCanvasFactory();

async function postData(data) {
    // POST result to BFF
    const bffHost = "https://rnwan-185-203-122-220.a.free.pinggy.link";
    await axios.post(`${bffHost}/api/documents/complete`, data)
        .then(console.log)
        .catch(console.error);
}

async function getBuffer(stream) {
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

        const { Body, ContentType, ContentLength, Metadata } =
            await s3.getObject({ Bucket: bucket, Key: key });

        const metadata = {
            contentType: ContentType,
            contentLength: ContentLength,
            ...Metadata
        };

        const thumbKey = `${key}.thumb.png`;
        const thumbContentType = "image/png";
        const thumbMetadata = { width: "100", height: "100" };

        const previewKey = `${key}.preview.png`;
        const previewContentType = "image/png";
        const previewMetadata = { width: "1000", height: "1000" };

        if (ContentType && ContentType.startsWith("image")
            && !key.endsWith("thumb.png") && !key.endsWith("preview.png")) {
            const imgBuffer = await getBuffer(Body);
            const thumbImgBuffer = await sharp(imgBuffer).resize(100, 100).png().toBuffer();

            await s3.putObject({
                Bucket: bucket,
                Key: thumbKey,
                Body: thumbImgBuffer,
                ContentType: thumbContentType,
                Metadata: thumbMetadata
            });

            await postData({
                key,
                thumbKey,
                metadata,
                thumbMetadata: {
                    contentType: thumbContentType,
                    contentLength: thumbImgBuffer.length,
                    ...thumbMetadata,
                }
            });
        } else if (ContentType === "application/pdf") {
            const pdfBuffer = await getBuffer(Body);

            const pdfDocument = await pdfJsLib.getDocument({
                data: pdfBuffer,
                cMapUrl: CMAP_URL,
                cMapPacked: CMAP_PACKED,
                standardFontDataUrl: STANDARD_FONT_DATA_URL,
                canvasFactory,
            }).promise;

            // Get the first page.
            const page = await pdfDocument.getPage(1);
            // Render the page on a Node canvas with 100% scale.
            const viewport = page.getViewport({ scale: 1.0 });
            const canvasAndContext = canvasFactory.create(
                viewport.width,
                viewport.height
            );
            const renderContext = {
                canvasContext: canvasAndContext.context,
                viewport,
                canvasFactory
            };

            await page.render(renderContext).promise;

            // Convert the canvas to an image buffer.
            const imgBuffer = canvasAndContext.canvas.toBuffer();

            // create thumb image
            const thumbImgBuffer = await sharp(imgBuffer).resize(
                100, 100, { fit: "contain" }).png().toBuffer();

            await s3.putObject({
                Bucket: bucket,
                Key: thumbKey,
                Body: thumbImgBuffer,
                ContentType: thumbContentType,
                Metadata: thumbMetadata
            });

            // create preview image
            const previewImgBuffer = await sharp(imgBuffer).resize(
                1000, 1000, { fit: "contain" }).png().toBuffer();

            await s3.putObject({
                Bucket: bucket,
                Key: previewKey,
                Body: previewImgBuffer,
                ContentType: previewContentType,
                Metadata: previewMetadata
            });

            await postData({
                key,
                thumbKey,
                previewKey,
                metadata,
                thumbMetadata: {
                    contentType: thumbContentType,
                    contentLength: thumbImgBuffer.length,
                    ...thumbMetadata,
                },
                previewMetadata: {
                    contentType: previewContentType,
                    contentLength: previewImgBuffer.length,
                    ...previewMetadata,
                }
            });
        }
    } catch (err) {
        console.log(err);
    }

    const response = {
        statusCode: 200,
        body: JSON.stringify('Ok'),
    };

    return response;
};
