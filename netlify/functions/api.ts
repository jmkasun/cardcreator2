import serverless from "serverless-http";
import app from "../../api/index";

export const handler = serverless(app, {
  binary: [
    'font/otf',
    'font/woff',
    'font/woff2',
    'image/*',
    'application/octet-stream'
  ]
});
