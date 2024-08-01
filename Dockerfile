FROM public.ecr.aws/shelf/lambda-libreoffice-base:7.6-node20-x86_64 AS builder
WORKDIR /usr/app
COPY package.json nodeCanvas.js index.js  ./
RUN npm install
RUN rm -rf node_modules/sharp
RUN npm install --arch=x64 --platform=linux sharp

FROM public.ecr.aws/shelf/lambda-libreoffice-base:7.6-node20-x86_64
WORKDIR ${LAMBDA_TASK_ROOT}
COPY --from=builder /usr/app/* ./
CMD ["index.handler"]