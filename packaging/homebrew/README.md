# Homebrew tap

`brew install ateebasif/tap/md-viewer` reads the formula from a separate repository,
**github.com/ateebasif/homebrew-tap**. Homebrew finds it by that name: `ateebasif/tap` means
the `homebrew-tap` repository under `ateebasif`.

## First release

1. Tag the release in this repository and push the tag:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. Get the checksum of the tag's source tarball:

   ```bash
   curl -fsSL https://github.com/ateebasif/md-viewer/archive/refs/tags/v1.0.0.tar.gz | shasum -a 256
   ```

3. Create a public repository named `homebrew-tap`. Copy `md-viewer.rb` into it as
   `Formula/md-viewer.rb`, put the checksum in `sha256`, then commit and push.

4. Check it works:

   ```bash
   brew install ateebasif/tap/md-viewer
   brew test md-viewer
   mdv --version
   ```

## Later releases

Bump `version` in `package.json`, tag `vX.Y.Z` and push the tag. Then, in the tap, update
`url` and `sha256` to the new tag. `brew upgrade md-viewer` picks it up.

## Why Finder setup is a separate step

Homebrew installs into its own prefix and can't write to `~/Applications` or
`~/Library/Services`. The formula's caveats tell people to run
`install.sh --finder-only`, which builds the app and Quick Action and points them at
Homebrew's stable `opt/` paths, so they keep working across upgrades of md-viewer and Node.
