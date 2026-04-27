import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        // All S3-specific options should be inside s3Options
        s3Options: {
          accessKeyId: env('AWS_ACCESS_KEY_ID'),
          secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
          region: env('AWS_REGION'),
          params: {
            Bucket: env('AWS_BUCKET_NAME'),
            ACL: 'public-read',
          },
          // Move baseUrl and rootPath inside s3Options
          baseUrl: `https://${env('AWS_BUCKET_NAME')}.s3.${env('AWS_REGION')}.amazonaws.com`,
          rootPath: 'uploads/',
        },
      },
      // Move these options outside of providerOptions
      actionOptions: {
        upload: {
          // Ensure ACL is set for uploads
          ACL: 'public-read',
        },
        uploadStream: {
          ACL: 'public-read',
        },
        delete: {},
      },
      // Disable breakpoints to prevent multiple image sizes
      breakpoints: {},
      // Add size limits
      sizeLimit: 50 * 1024 * 1024, // 50MB
      // Disable responsive dimensions to prevent multiple versions
      responsiveDimensions: false,
    },
  },
});

export default config;
