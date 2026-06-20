# Ghi chu doi chieu file Income Shopee

## Boi canh

File Income cua Shopee co sheet `Doanh thu` voi 2 loai dong:

- `Order`: dong tong quan cua ca don hang.
- `Sku`: dong chi tiet tung san pham / phan loai trong don.

Khi doi chieu voi file export cua app, can chu y rang Shopee khong tinh cot `Gia san pham` giong nhau o 2 loai dong nay trong truong hop co hoan hang.

## Cot "Gia san pham"

Trong file Income Shopee, cot `Gia san pham` tuong ung gan nhat voi cot `Don gia sau giam` trong file app.

Tuy nhien voi don co hoan hang:

- Dong `Order` cua Shopee giu `Gia san pham` truoc khi tru hoan hang.
- Khoan hoan hang duoc tach rieng o cot `So tien hoan lai`.
- Dong `Sku` cua Shopee lai phan anh gia tri san pham sau khi da tru phan hoan cua SKU do.

Vi du:

```txt
Don co 3 SKU:
A = 100,000
B = 100,000
C = 100,000

Tong ban dau = 300,000
Khach hoan SKU C = 100,000
```

Shopee se hien thi gan nhu:

```txt
Dong Order:
Gia san pham     = 300,000
So tien hoan lai = -100,000

Dong SKU:
SKU A Gia san pham = 100,000
SKU B Gia san pham = 100,000
SKU C Gia san pham = 0
Tong SKU          = 200,000
```

Vi vay khi tong hop:

```txt
Order / Gia san pham = 300,000
SKU / Gia san pham   = 200,000
```

Day la hanh vi binh thuong cua file Income Shopee, khong phai loi du lieu.

## Logic trong app

De match cach Shopee hien thi:

1. Dong `Order`:
   - Cot `Don gia sau giam` duoc tinh la gia truoc hoan hang.
   - Neu API escrow tra gia da tru hoan, app cong nguoc khoan `seller_return_refund` de ra gia truoc hoan.

2. Dong `Sku`:
   - Cot `Don gia sau giam` duoc tinh la gia sau khi tru tien hoan cua SKU.
   - App dung `return_details.item[].refund_amount` neu Shopee tra ve.
   - Neu khong co `refund_amount`, app fallback ve `item_price * amount`.

## Cong thuc doi chieu tong doanh thu

Trong Summary cua file Income Shopee:

```txt
Tong doanh thu =
  Gia san pham
+ So tien hoan lai
+ San pham duoc tro gia tu Shopee
+ Ma uu dai do Nguoi Ban chiu
+ Ma uu dai Dong Tai Tro do Nguoi Ban chiu
+ Ma hoan xu do Nguoi Ban chiu
+ Ma hoan xu Dong Tai Tro do Nguoi Ban chiu
```

Luu y:

- Cong thuc Summary nen tinh tren dong `Order`.
- Khong cong ca dong `Order` va `Sku` cung luc vi se double count.
- Cot `Tong tien da thanh toan` khong phai la `Tong doanh thu`; no gan voi tien seller nhan duoc sau phi, thue, van chuyen va cac dieu chinh hon.

## Ngay hoan thanh thanh toan

Mode `Ngay hoan thanh thanh toan` cua app nen di theo API `v2.payment.get_income_detail` voi `income_status = 1` (Released), khong dung `order.pay_time`.

Ly do:

- `order.pay_time` la thoi diem buyer/order duoc ghi nhan thanh toan.
- File Income cua Shopee dung ngay income/payout duoc phat hanh cho seller.
