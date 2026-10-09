# 課表

純靜態網頁(HTML/JS)+ Supabase(登入/資料庫)+ GitHub Pages(部署)。

## 設定步驟
1. **Supabase**:建立專案 → SQL Editor 貼上 `supabase.sql` 執行。
   - Authentication > Providers > Email:想省略信箱驗證可關掉 "Confirm email"。
   - Authentication > URL Configuration:Site URL 填你的 GitHub Pages 網址。
2. 把 Project Settings > API 的 **Project URL** 與 **anon public key** 填進 `config.js`。
3. **GitHub**:建 repo、push 到 `main`;Settings > Pages > Source 選 **GitHub Actions**。
4. 網址:`https://<帳號>.github.io/<repo>/`

沒填 `config.js` 也能用,資料存在瀏覽器 localStorage。

## 操作
- 點空白格 / 右下 ＋ 新增課程;點課程編輯、刪除
- 一門課可有多個時段(例如經濟學週二、週三)
- 衝堂會用虛線框並排顯示,儲存時會提醒
- 左下切換 / 新增學期;⚙ 可顯示週末、A–D 節
