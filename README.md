# Deploying to AWS

## 1. Build the image

```bash
docker build --platform linux/amd64 -t s3-file-processor:latest .
```

## 2. Run the get-login-password command to authenticate the Docker CLI to your Amazon ECR registry

- Set the --region value to the AWS Region where you want to create the Amazon ECR repository.
- Replace 111122223333 with your AWS account ID.

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 111122223333.dkr.ecr.us-east-1.amazonaws.com
```

## 3. Create a repository in Amazon ECR using the create-repository command.

```bash
aws ecr create-repository --repository-name s3-file-processor --region us-east-1 --image-scanning-configuration scanOnPush=true --image-tag-mutability MUTABLE
```

If successful, you see a response like this:

```json
{
    "repository": {
        "repositoryArn": "arn:aws:ecr:us-east-1:111122223333:repository/s3-file-processor",
        "registryId": "111122223333",
        "repositoryName": "s3-file-processor",
        "repositoryUri": "111122223333.dkr.ecr.us-east-1.amazonaws.com/s3-file-processor",
        "createdAt": "2023-03-09T10:39:01+00:00",
        "imageTagMutability": "MUTABLE",
        "imageScanningConfiguration": {
            "scanOnPush": true
        },
        "encryptionConfiguration": {
            "encryptionType": "AES256"
        }
    }
}
```

## 3. Deploy local image to AWS ECR repository

Copy the repositoryUri from the output in the previous step and run the docker tag command to tag your local image into your Amazon ECR repository as the latest version

```bash
docker tag s3-file-processor:latest 111122223333.dkr.ecr.us-east-1.amazonaws.com/s3-file-processor:latest
```

Run the docker push command to deploy your local image to the Amazon ECR repository. Make sure to include :latest at the end of the repository URI.

```bash
docker push 111122223333.dkr.ecr.us-east-1.amazonaws.com/s3-file-processor:latest
```

## 4. Create lambda function

Create the Lambda function. For ImageUri, specify the repository URI from earlier. Make sure to include :latest at the end of the URI.

```bash
aws lambda create-function \
  --function-name s3-file-processor \
  --package-type Image \
  --code ImageUri=111122223333.dkr.ecr.us-east-1.amazonaws.com/s3-file-processor:latest \
  --role arn:aws:iam::111122223333:role/lambda-ex
```

## 4. Lambda configuration
- At least 3008 MB of RAM is recommended
- At least 45 seconds of Lambda timeout is necessary
- For larger files support, you can [extend Lambda's /tmp space](https://aws.amazon.com/blogs/aws/aws-lambda-now-supports-up-to-10-gb-ephemeral-storage/) using the ephemeral-storage parameter
- Set environment variable HOME to /tmp
