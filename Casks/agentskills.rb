cask "agentskills" do
  version "0.1.8"
  arch arm: "aarch64", intel: "x64"
  sha256 :no_check

  url "https://github.com/chrlsio/agent-skills/releases/download/v#{version}/AgentSkills_#{version}_#{arch}.dmg"

  name "AgentSkills"
  desc "Cross-platform desktop app for managing AI agent skills"
  homepage "https://github.com/chrlsio/agent-skills"

  app "AgentSkills.app"

  zap trash: [
    "~/Library/Application Support/com.agentskills.app",
    "~/Library/Caches/com.agentskills.app",
    "~/Library/Preferences/com.agentskills.app.plist",
    "~/Library/Saved Application State/com.agentskills.app.savedState"
  ]

  caveats <<~EOS
    If you encounter the "App is damaged" error, run:
      sudo xattr -rd com.apple.quarantine "/Applications/AgentSkills.app"

    Or install with:
      brew install --cask --no-quarantine agentskills
  EOS
end
