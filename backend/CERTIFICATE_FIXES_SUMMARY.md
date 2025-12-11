# Certificate System Fixes - December 11, 2024

## Issues Fixed

### 1. ❌ Image Upload Not Saving to Template
**Problem:** When editing a template and uploading a background image, the image URL was not being saved to the database.

**Root Cause:** The backend `PUT /certificate-templates/:id` endpoint was not accepting or saving the new image-related fields.

**Solution:** Updated the endpoint to accept and save all image template fields:
- `use_background_mode`
- `background_image_url`
- `text_positions`
- `logo_url`
- `logo_position`
- `header_image_url`
- `footer_image_url`
- `signature_image_url`
- `signature_position`

**Files Modified:**
- `backend/src/routes/whs.ts` - Lines 2097-2165 (PUT endpoint)
- `backend/src/routes/whs.ts` - Lines 2043-2120 (POST endpoint)

---

### 2. ❌ Corrupted/Failed to Load Certificate Images
**Problem:** Certificate template images were showing as corrupted or failing to load with `ERR_NAME_NOT_RESOLVED` error.

**Root Cause:** Direct R2 URLs (e.g., `https://pub-xxx.r2.dev/...`) were experiencing DNS resolution issues in certain network configurations.

**Solution:** Implemented a proxy system similar to incident photos:
1. Images are uploaded to R2 and return a proxy URL
2. Proxy URL format: `/api/whs/certificate-image/{userId}/{imageId}`
3. Backend fetches from R2 and streams to browser
4. No database lookup required - path is constructed from URL

**Files Modified:**
- `backend/src/utils/photoUrl.ts` - Added `getCertificateImageProxyUrl()` function
- `backend/src/routes/whs.ts` - Added `GET /certificate-image/:userId/:imageId` endpoint
- `backend/src/routes/whs.ts` - Updated upload endpoint to return proxy URLs
- `backend/src/routes/whs.ts` - Updated GET endpoints to convert URLs to proxy format
- `backend/src/routes/whs.ts` - Updated certificate generation to use proxy URLs

---

## How It Works Now

### Image Upload Flow
```
1. User uploads image in frontend
2. Frontend sends to POST /whs/certificates/upload-image
3. Backend uploads to R2: certificates/{userId}/{timestamp}-{random}.{ext}
4. Backend returns proxy URL: /api/whs/certificate-image/{userId}/{imageId}
5. Frontend stores proxy URL in form state
6. User saves template
7. Backend saves proxy URL to database
```

### Image Display Flow
```
1. Frontend requests template from backend
2. Backend returns template with proxy URLs
3. Browser requests image: GET /api/whs/certificate-image/{userId}/{imageId}
4. Backend constructs R2 path and fetches image
5. Backend streams image to browser with cache headers
```

### Certificate Generation Flow
```
1. WHS generates certificate with template
2. Backend converts all R2 URLs to proxy URLs
3. Generated HTML uses proxy URLs for all images
4. Certificate displays correctly with all images
```

---

## Testing Checklist

- [x] Upload background image in Create Template
- [x] Upload background image in Edit Template
- [x] Save template with background image
- [x] Verify image displays in template preview
- [x] Generate certificate with background image
- [x] Verify certificate displays correctly
- [x] Test with logo, signature images
- [x] Verify proxy URLs are generated correctly
- [x] Test image caching (should cache for 1 year)

---

## Benefits

1. **Reliability** - No more DNS resolution issues
2. **Performance** - 1-year cache headers reduce server load
3. **Simplicity** - No database lookup required for proxy
4. **Consistency** - Same pattern as incident photos
5. **Security** - Can add authentication later if needed

---

## Migration Notes

**No migration required!** 

Existing templates with R2 URLs will automatically be converted to proxy URLs when fetched from the backend. The conversion happens on-the-fly in the GET endpoints.

New uploads will immediately use proxy URLs.

---

## Troubleshooting

### Images Still Not Displaying
1. Restart backend server to pick up code changes
2. Clear browser cache (Ctrl+Shift+R)
3. Check backend logs for R2 errors
4. Verify R2 credentials in `.env`

### Images Not Saving to Template
1. Check browser Network tab for API errors
2. Verify template update request includes image fields
3. Check backend logs for database errors
4. Ensure `use_background_mode` is set to `true`

### Proxy URL Format Issues
Expected format: `/api/whs/certificate-image/{userId}/{imageId}`
If different, check `getCertificateImageProxyUrl()` function

---

## Related Documentation
- `backend/CERTIFICATE_IMAGE_PROXY.md` - Detailed proxy system documentation
- `frontend/src/pages/dashboard/whs-control-center/certificates/README.md` - Frontend documentation


