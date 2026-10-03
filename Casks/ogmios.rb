# Homebrew cask, tapped straight from this repository:
#   brew tap ilien-dev/ogmios https://github.com/ilien-dev/ogmios
#   brew install --cask ogmios
# It always installs the latest release; after that the app updates itself.
cask "ogmios" do
  arch arm: "aarch64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/ilien-dev/ogmios/releases/latest/download/Ogmios_#{arch}.dmg"
  name "Ogmios"
  desc "Speak English, get feedback at the end"
  homepage "https://github.com/ilien-dev/ogmios"

  auto_updates true
  depends_on macos: ">= :big_sur"

  app "Ogmios.app"

  # The app is ad-hoc signed, not notarised: without this macOS refuses to
  # open it.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Ogmios.app"]
  end

  zap trash: [
    "~/Library/Application Support/dev.ilien.ogmios",
    "~/Library/Caches/dev.ilien.ogmios",
    "~/Library/WebKit/dev.ilien.ogmios",
  ]
end
