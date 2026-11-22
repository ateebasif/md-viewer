# Homebrew formula for md-viewer. The live copy belongs in the tap repository
# github.com/ateebasif/homebrew-tap at Formula/md-viewer.rb; see packaging/homebrew/README.md.
class MdViewer < Formula
  desc "Fast, offline Markdown viewer for macOS with live reload"
  homepage "https://github.com/ateebasif/md-viewer"
  url "https://github.com/ateebasif/md-viewer/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "REPLACE_WITH_SHA256_OF_THE_TAG_TARBALL"
  license "MIT"

  depends_on :macos
  depends_on "node"

  def install
    system "npm", "ci", "--omit=dev", "--no-audit", "--no-fund"
    libexec.install Dir["*"]
    # The CLI's shebang is `env node`; point it at Homebrew's node so nvm etc. don't matter.
    (bin/"mdv").write_env_script libexec/"bin/mdv.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
    bin.install_symlink "mdv" => "md-viewer"
  end

  def caveats
    <<~EOS
      To add md-viewer to Finder (Open With, drag and drop, and the
      "View in md-viewer" Quick Action), run:
        #{opt_libexec}/install.sh --finder-only

      Before `brew uninstall md-viewer`, remove the app and settings with:
        #{opt_libexec}/uninstall.sh
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/mdv --version")
  end
end
