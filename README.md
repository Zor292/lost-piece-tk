# LostPiece Ticket Bot

## التشغيل

1. انسخ `.env.example` وسمّه `.env`
2. ضع توكن البوت وايدي السيرفر
3. شغّل:

```
npm install
npm start
```

## البيانات
يتم حفظ كل البيانات محلياً في مجلد `src/data/`:
- `tickets.json` - التذاكر
- `warnings.json` - التحذيرات
- `counter.json` - عداد التذاكر

لا يحتاج MongoDB.
