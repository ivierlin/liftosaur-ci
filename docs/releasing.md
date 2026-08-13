# Release liftosaur-ci

This project currently publishes releases manually. Release tags use the exact
package version, such as `0.2.0`.

## Pre-1.0 workflow compatibility

The moving `0` tag is the compatibility channel used by the public reusable
workflow examples. Every release pointed to by `0` must remain compatible with
existing reusable-workflow callers. If a release would break an existing `@0`
caller, preserve the old interface or stop advancing `0` until a documented
migration path exists.

This is deliberately stricter than the compatibility normally implied between
different pre-1.0 minor versions.

## Tag a compatible release

After the release commit is reviewed and all checks pass:

1. Fetch tags and record the current remote value of `0`, if it exists:

   ```sh
   git fetch origin --tags
   old_zero=$(git rev-parse refs/tags/0 2>/dev/null || true)
   release_commit=$(git rev-parse HEAD)
   ```

2. Create and push the immutable version tag:

   ```sh
   git tag 0.2.0 "$release_commit"
   git push origin refs/tags/0.2.0
   ```

3. Move `0` to the same release commit. Use a lease when the tag already exists
   so a concurrent release cannot be overwritten unnoticed:

   ```sh
   git tag -f 0 "$release_commit"
   git push --force-with-lease="refs/tags/0:$old_zero" origin refs/tags/0
   ```

   For the first compatible release, when `0` does not yet exist, use:

   ```sh
   git push origin refs/tags/0
   ```

4. Verify both remote tags resolve directly to the release commit before
   publishing the release notes:

   ```sh
   git ls-remote origin refs/tags/0 refs/tags/0.2.0
   ```

Replace `0.2.0` with the release version. Never move an immutable version tag.
