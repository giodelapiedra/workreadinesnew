# Certificate Image Proxy System

## Overview
This document explains the proxy URL system for certificate template images, which solves DNS resolution issues with Cloudflare R2 public URLs.

## Problem
When certificate template images are uploaded to Cloudflare R2, the direct R2 URLs (e.g., `https://pub-xxx.r2.dev/...`) sometimes fail to load in browsers due to DNS resolution issues, especially in certain network configurations.

## Solution
Similar to the incident photo proxy system, we route all certificate image requests through the backend server, which fetches the images from R2 and serves them directly.

## Architecture

### 1. Image Upload Flow
```
Frontend → POST /api/whs/certificates/upload-image
         → Backend uploads to R2
         → Backend returns proxy URL: /api/whs/certificate-image/{imageId}
```

### 2. Image Retrieval Flow
```
Browser → GET /api/whs/certificate-image/{userId}/{imageId}
        → Backend constructs R2 path: certificates/{userId}/{imageId}
        → Backend fetches from R2
        → Backend streams image to browser
```

## Implementation Details

### Backend Files Modified

#### 1. `backend/src/utils/photoUrl.ts`
Added `getCertificateImageProxyUrl()` function:
- Converts R2 URLs to proxy URLs
- Format: `/api/whs/certificate-image/{imageId}`
- Only converts R2 URLs (`.r2.dev` or `r2.cloudflarestorage.com`)
- Returns other URLs unchanged

#### 2. `backend/src/routes/whs.ts`

**New Proxy Endpoint:**
```typescript
GET /whs/certificate-image/:userId/:imageId
```
- No authentication required (public endpoint for viewing certificates)
- Constructs R2 path directly from URL parameters
- Fetches image from R2 at `certificates/{userId}/{imageId}`
- Streams to browser with proper headers
- Includes 1-year cache headers for performance

**Modified Upload Endpoint:**
```typescript
POST /whs/certificates/upload-image
```
- Uploads image to R2
- Converts R2 URL to proxy URL before returning
- Returns proxy URL to frontend

**Modified GET Endpoints:**
- `GET /whs/certificate-templates` - Converts all image URLs to proxy URLs
- `GET /whs/certificate-templates/:id` - Converts all image URLs to proxy URLs

**Modified Certificate Generation:**
- `POST /whs/certificates/generate` - Uses proxy URLs in generated HTML

### Image Fields Supported
All certificate template image fields are proxied:
- `background_image_url` - Full template background
- `logo_url` - Company/organization logo
- `header_image_url` - Header decoration
- `footer_image_url` - Footer decoration
- `signature_image_url` - Authorized signature

## Benefits

1. **Reliability**: Eliminates DNS resolution issues
2. **Security**: Backend validates access permissions
3. **Caching**: 1-year cache headers improve performance
4. **Consistency**: Same pattern as incident photos
5. **Fallback**: Redirects to original URL if R2 fetch fails

## Frontend Changes
No frontend changes required! The frontend continues to use the URLs returned by the backend API, which are now automatically proxy URLs.

## Testing

### Test Image Upload
1. Go to Certificate Management
2. Create/Edit a template
3. Upload a background image
4. Verify the returned URL format: `/api/whs/certificate-image/{imageId}`

### Test Image Display
1. Open Edit Template modal
2. Verify background image preview loads
3. Generate a certificate
4. Verify certificate displays with images

### Test Proxy Endpoint
```bash
# Get a template with images
curl -H "Authorization: Bearer {token}" \
  http://localhost:3000/api/whs/certificate-templates/{id}

# Access proxy URL (no auth required)
curl http://localhost:3000/api/whs/certificate-image/{userId}/{imageId}
```

## Troubleshooting

### Images Not Loading
1. Check backend logs for R2 errors
2. Verify R2 credentials in `.env`
3. Confirm image exists in R2 bucket
4. Check browser network tab for 404/500 errors

### Proxy URL Not Generated
1. Verify `getCertificateImageProxyUrl` is imported
2. Check that upload endpoint returns proxy URL
3. Restart backend to pick up code changes

## Related Files
- `backend/src/utils/photoUrl.ts` - Proxy URL utilities
- `backend/src/utils/r2Storage.ts` - R2 upload/download
- `backend/src/routes/whs.ts` - Certificate endpoints
- `frontend/src/pages/dashboard/whs-control-center/certificates/` - Frontend components

