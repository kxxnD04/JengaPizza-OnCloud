@echo off
echo Warming up Jenga pizza's oven.......

start powershell.exe -NoExit -Command "cd ./jenga_project; npm i; node init-db.js; npm run start_oven"

timeout /t 5

start http://localhost:3000
echo Jenga Pizza is now open and ready to serve!