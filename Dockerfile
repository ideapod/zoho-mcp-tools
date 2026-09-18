# Runs the MCP server as a normal Node.js HTTP process inside an AWS Lambda
# container image. The AWS Lambda Web Adapter (https://github.com/aws/aws-lambda-web-adapter)
# extension translates Lambda Function URL / API Gateway events into real
# HTTP requests against this process on localhost, including support for
# response streaming (needed for the MCP SDK's SSE-based streamable-HTTP
# transport). This lets the server be written and tested exactly like any
# other Node HTTP server, with no Lambda-specific request/response glue code.
FROM public.ecr.aws/awsguru/aws-lambda-adapter:1.0.1 AS lambda-adapter

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM node:22-slim
WORKDIR /var/task

COPY --from=lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/src ./dist/src

ENV PORT=8080
ENV AWS_LWA_INVOKE_MODE=response_stream
ENV AWS_LWA_READINESS_CHECK_PATH=/health

EXPOSE 8080
CMD ["node", "dist/src/local.js"]
