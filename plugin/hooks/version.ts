// The plugin's version, for the pane's title. A mod cannot read its own plugin.json while it runs,
// so it is kept here; .github/scripts/check-version.sh fails CI when it differs from plugin.json's.
export const VERSION = '0.4.0'
