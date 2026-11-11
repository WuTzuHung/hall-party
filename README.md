# 光之殿堂 · TL × GEN 冠軍賽 3D 觀賽派對

用網址進來就能進入的多人 3D 空間，場景還原紐約曼哈頓的 Hall des Lumières（光之殿堂，原 Emigrant Industrial Savings Bank，49 Chambers St.）。

- 進站先選角色顏色（粉紅 / 天藍），角色是沒有五官的可愛豆豆人
- 出生在大樓外的人行道，自己走上台階、穿過大門進入大廳
- 大廳盡頭的大螢幕播放 YouTube 影片或直播，所有人同步
- 自由行走、轉視角、滾輪或雙指縮放拉近（拉到最近變第一人稱）、走到椅子旁按 E 或點「坐下」
- 看得到其他人即時走動、坐下與站起
- 同時在線人數有上限，滿了會排隊，有人離開自動進場

## 本機執行

```bash
npm install
ADMIN_PASSWORD=你的密碼 npm start
# 開 http://localhost:3000 ，管理頁 http://localhost:3000/admin
```

## 環境變數

| 名稱 | 說明 | 預設 |
|---|---|---|
| `ADMIN_PASSWORD` | 管理後台密碼（**一定要設**） | `changeme` |
| `MAX_USERS` | 第一次啟動時的人數上限，之後可在後台改 | `60` |
| `PORT` | 埠號（雲端平台會自動給） | `3000` |

## 更換大螢幕影片

1. 打開 `https://你的網址/admin`，輸入密碼
2. 貼上 YouTube 網址（`watch?v=`、`youtu.be/`、`/live/` 都可以），直播請勾「這是直播」
3. 按「播放到大螢幕」，所有人的畫面會立刻換掉

也可以用指令（例如請 Claude 幫你換）：

```bash
curl -X POST https://你的網址/api/admin/video \
  -H "Authorization: Bearer 你的密碼" -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=XXXXXXXXXXX","live":true,"title":"TL vs GEN 第一場"}'
```

其他 API：`POST /api/admin/control`（`{"action":"play"|"pause"|"restart"|"seek","seconds":123}`）、`POST /api/admin/settings`（`{"maxUsers":80}`）、`GET /api/admin/state`。

## 部署到 Render（免費）

1. 把這個資料夾推到 GitHub 儲存庫
2. 到 https://dashboard.render.com → New → Blueprint → 選這個儲存庫（會讀 `render.yaml`）
3. 填入 `ADMIN_PASSWORD`，按 Apply
4. 幾分鐘後會拿到 `https://hall-des-lumieres-xxxx.onrender.com`，這就是分享出去的網址

免費方案閒置 15 分鐘會休眠，第一個人進來要等約 30–60 秒喚醒；派對當天建議升級 Starter 方案（每月 7 美元）或活動前先開一次網頁。免費方案重啟後後台設定會回到預設，派對前再設定一次影片即可。

## 人數上限建議

預設 60 人。理由：

- 每人每秒上傳 10 次位置，伺服器把所有人的位置合併成一包廣播，60 人時每位使用者下載約 20–30 KB/s，免費主機頻寬撐得住
- 畫面上 60 個角色對一般筆電與手機沒有負擔，最吃效能的是建築本身與 YouTube 播放
- 影片是每個人直接從 YouTube 串流，不經過伺服器，所以人數不影響影片品質

升級到付費主機後可以放心調到 100–150 人。

## 檔案

- `server.js`：HTTP + WebSocket 伺服器、人數上限與排隊、影片同步、管理 API
- `public/js/world.js`：建築外觀與室內大廳（全部程序化建模，不需下載模型檔）
- `public/js/textures.js`：石灰岩、大理石、藻井、彩繪玻璃等程序化貼圖
- `public/js/avatar.js`：無五官的可愛角色
- `public/js/screen.js`：把 YouTube 放進 3D 大螢幕並同步進度
- `public/js/main.js`：操作、相機、碰撞、坐下、連線
- `public/admin.html`：管理後台
