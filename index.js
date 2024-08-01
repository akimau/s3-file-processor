const { S3 } = require("@aws-sdk/client-s3");
const axios = require("axios");
const sharp = require("sharp");
const pdfJsLib = require("pdfjs-dist");
const libre = require('libreoffice-convert');
libre.convertAsync = require('util').promisify(libre.convert);
const NodeCanvasFactory = require("./nodeCanvas");

const s3 = new S3({ region: "us-east-1" });

// Some PDFs need external cmaps.
const CMAP_URL = "./node_modules/pdfjs-dist/cmaps/";
const CMAP_PACKED = true;

// Where the standard fonts are located.
const STANDARD_FONT_DATA_URL =
    "./node_modules/pdfjs-dist/standard_fonts/";

const canvasFactory = new NodeCanvasFactory();

const debug = true;

// post data
async function postData(data) {
    // POST result to BFF
    const bffHost = "https://rnwan-185-203-122-220.a.free.pinggy.link";
    const debugUrl = "https://webhook.site/24d64332-b1e8-4df1-b712-f7458b3ac712";
    const url = debug ? debugUrl : `${bffHost}/api/documents/complete`;
    await axios.post(url, data)
        .then(console.log)
        .catch(console.error);
}

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

// save file to s3
async function s3PutObject(bucket, key, body, contentType, metadata) {
    await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata
    });
}

// get pdf image
async function getPdfImage(pdf) {
    const pdfDocument = await pdfJsLib.getDocument({
        data: pdf,
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
    return canvasAndContext.canvas.toBuffer();
}

// generate thumb from uploaded image file and save to s3 bucket
async function generateImageThumb(bucket, key, metadata, img) {
    const thumbKey = `${key}.thumb.png`;
    const thumbContentType = "image/png";
    const thumbMetadata = { width: "100", height: "100" };

    const thumbImgBuffer = await sharp(img).resize(100, 100,
        { fit: "contain" }).png().toBuffer();

    await s3PutObject(bucket, thumbKey, thumbImgBuffer, thumbContentType, thumbMetadata);

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
}

// generate thumb and preview from uploaded pdf file and save to s3 bucket
async function generatePdfThumbAndPreview(bucket, key, metadata, pdf) {
    const thumbKey = `${key}.thumb.png`;
    const thumbContentType = "image/png";
    const thumbMetadata = { width: "100", height: "100" };

    const previewKey = `${key}.preview.png`;
    const previewContentType = "image/png";
    const previewMetadata = { width: "1000", height: "1000" };

    const pdfImgBuffer = await getPdfImage(pdf);

    // create and save thumb image
    const thumbImgBuffer = await sharp(pdfImgBuffer).resize(
        100, 100, { fit: "contain" }).png().toBuffer();

    await s3PutObject(bucket, thumbKey, thumbImgBuffer, thumbContentType, thumbMetadata);

    // create and save preview image
    const previewImgBuffer = await sharp(pdfImgBuffer).resize(
        1000, 1000, { fit: "contain" }).png().toBuffer();

    await s3PutObject(bucket, previewKey, previewImgBuffer, previewContentType, previewMetadata);

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

// generate thumb and preview from uploaded doc/docx file and save to s3 bucket
async function generateDocThumbAndPreview(bucket, key, metadata, doc) {
    // Convert doc to pdf format with undefined filter (see Libreoffice docs about filter)
    const ext = '.pdf'; // Output extension.
    const pdf = await libre.convertAsync(doc, ext, undefined);
    await generatePdfThumbAndPreview(bucket, key, metadata, pdf);
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

        if (ContentType && ContentType.startsWith("image")
            && !key.endsWith("thumb.png") && !key.endsWith("preview.png")) {
            const img = await streamToBuffer(Body);
            await generateImageThumb(bucket, key, metadata, img);
        } else if (ContentType === "application/pdf") {
            const pdf = await streamToBuffer(Body);
            await generatePdfThumbAndPreview(bucket, key, metadata, pdf);
        } else if (ContentType === "application/msword" ||
            ContentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const doc = await streamToBuffer(Body);
            await generateDocThumbAndPreview(bucket, key, metadata, doc);
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
