Set Shell "zsh"
Set FontSize 24
Set Width 1920
Set Height 1080
Set Padding 56
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WaitTimeout 170s
Hide
Type "cd ../.. && export PS1='$ ' && clear"
Enter
Sleep 500ms
Show
Sleep 700ms
Type "bun video/tools/recipe-stream.ts luma-blasts compiled-8lsr"
Sleep 400ms
Enter
Wait+Screen /run\.end/
Sleep 3s
