-- MDView: hands files and folders from Finder to the mdv CLI.
-- The two paths below are filled in by install.sh with absolute paths,
-- because apps launched from Finder don't inherit your shell's PATH.
property runtimePath : "__RUNTIME__"
property cliPath : "__CLI__"

on run
	activate
	try
		set choice to button returned of (display dialog "Open a Markdown file or a folder of Markdown files." buttons {"Cancel", "Folder…", "File…"} default button "File…" cancel button "Cancel" with title "MDView")
	on error number -128
		return
	end try
	try
		if choice is "File…" then
			set picked to choose file with prompt "Choose a Markdown file" of type {"net.daringfireball.markdown", "md", "markdown", "mdown", "mkd"}
		else
			set picked to choose folder with prompt "Choose a folder to browse"
		end if
	on error number -128
		return
	end try
	launchViewer({picked})
end run

on open theItems
	launchViewer(theItems)
end open

on launchViewer(theItems)
	set cmds to ""
	repeat with anItem in theItems
		set p to POSIX path of anItem
		set cmds to cmds & quoted form of runtimePath & " " & quoted form of cliPath & " " & quoted form of p & "; "
	end repeat
	-- Backgrounded so the app quits right away; the CLI starts or reuses the server.
	do shell script "(" & cmds & ") >>\"$HOME/Library/Logs/mdv.log\" 2>&1 &"
end launchViewer
