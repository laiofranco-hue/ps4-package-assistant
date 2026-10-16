set appPath to POSIX path of (path to me)
set resourcesPath to appPath & "Contents/Resources/"
do shell script "/bin/zsh " & quoted form of (resourcesPath & "start.sh")
