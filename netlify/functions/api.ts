import serverless from "serverless-http";
import app from "../../api/index";

export const handler = serverless(app, {
  binary: [
    'font/otf',
    'font/woff',
    'font/woff2',
    'application/font-woff',
    'application/font-woff2',
    'application/font-otf',
    'application/x-font-woff',
    'application/x-font-otf',
    'image/*',
    'application/octet-stream'
  ]
});
