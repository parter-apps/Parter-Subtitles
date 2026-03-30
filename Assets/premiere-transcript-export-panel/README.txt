Parter Transcript Export panel

What it does
- Opens as a small UXP panel in Premiere.
- Gets the active project and active sequence.
- First tries sequence.getProjectItem().
- If that is not available, it falls back to the selected sequence in the Project panel.
- Casts that project item to ClipProjectItem.
- Calls Transcript.exportToJSON().
- Prompts you for an export folder and writes three files there:
- raw transcript JSON
- sentence-grouped JSON derived from word-level `eos`
- TXT generated from transcript words in the sample `HH:MM:SS:FF - HH:MM:SS:FF` + text format

How to load it
1. Install Premiere Pro 25.6 or later and UXP Developer Tool 2.2 or later.
2. Enable Premiere Developer Mode in Settings > Plugins, then restart Premiere.
3. Open UXP Developer Tool.
4. Add the plugin by selecting this file:
   /Users/danieldickinson/Documents/GitHub/Parter Subtitles/Assets/premiere-transcript-export-panel/manifest.json
5. Load the plugin.
6. In Premiere, open the panel and click "Export Transcript, Sentences and TXT".

If it works
- Choose the destination folder.
- The panel log shows the steps and the saved paths.

If it fails
- Copy the panel log.
- The log will tell us whether the failure is:
  - active sequence lookup
  - sequence project item lookup
  - ClipProjectItem casting
  - Transcript.exportToJSON
  - file saving
- If project item lookup fails, select the active sequence in the Project panel and try again.
