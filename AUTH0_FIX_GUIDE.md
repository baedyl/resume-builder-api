# 🔧 FIX: Auth0 401 "Invalid Token" Error

## ✅ DEPLOYMENT SUCCESS!
**Great job deploying to Railway**: `api.proairesume.online`

## ❌ COMMON AUTH0 MIGRATION ISSUE
**The 401 error is typical when migrating platforms** - Auth0 needs configuration updates for the new domain.

## 🔍 ROOT CAUSE ANALYSIS

**Auth0 configuration mismatch**:
1. **Domain Mismatch**: Auth0 still configured for old domain
2. **Token Validation**: JWT verification failing due to domain mismatch
3. **Environment Variables**: Missing/incorrect Auth0 settings

## 🚀 IMMEDIATE FIXES

### Fix 1: Update Auth0 Application Settings (5 minutes)

1. **Go to Auth0 Dashboard** → Applications → Your Application
2. **Update "Allowed Callback URLs"**:
   ```
   https://api.proairesume.online/auth/callback
   https://api.proairesume.online/api/auth/callback
   ```

3. **Update "Allowed Logout URLs"**:
   ```
   https://api.proairesume.online
   ```

4. **Update "Allowed Web Origins"**:
   ```
   https://api.proairesume.online
   ```

### Fix 2: Verify Environment Variables (2 minutes)

**In Railway, check these environment variables:**
```bash
AUTH0_DOMAIN=your-auth0-domain.auth0.com
AUTH0_AUDIENCE=https://api.proairesume.online
AUTH0_CLIENT_SECRET=your_client_secret
```

**Important**: The `AUTH0_AUDIENCE` should match your new API domain.

### Fix 3: Update Frontend Configuration (3 minutes)

**In your frontend, update API base URL:**
```javascript
// Update from old domain to new
const API_BASE_URL = 'https://api.proairesume.online';
```

### Fix 4: Test Token Validation (2 minutes)

**Test endpoint** to verify Auth0 setup:
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     https://api.proairesume.online/api/resumes
```

## 🎯 EXPECTED RESULT

After Fixes 1-3:
- ✅ **Login should work** (already working)
- ✅ **API calls should work** (no more 401 errors)
- ✅ **Token validation should pass**

## 🆘 IF ISSUE PERSISTS

**Check Auth0 Logs**:
1. Go to Auth0 Dashboard → Monitoring → Logs
2. Look for "Invalid Token" errors
3. Check if domain/auth0 audience mismatch

**Common Issues**:
- **Wrong AUTH0_AUDIENCE**: Must match new API domain exactly
- **Missing Callback URLs**: Must include new domain paths
- **Token Expiration**: Check if tokens are expired

## 📋 VERIFICATION CHECKLIST

After applying fixes:
- [ ] Auth0 application settings updated
- [ ] Environment variables verified in Railway
- [ ] Frontend API URL updated
- [ ] Test API call works (no 401 error)
- [ ] Auth0 logs show successful token validation

## 🔄 QUICK TEST

```bash
# Test health endpoint (should work)
curl https://api.proairesume.online/health

# Test authenticated endpoint (should work after fixes)
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://api.proairesume.online/api/resumes
```

**This should resolve the 401 error and get your full API working!** 🚀