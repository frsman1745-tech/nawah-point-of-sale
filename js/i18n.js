(function () {
  var STORAGE_KEY = 'nawa_lang';
  var currentLang = localStorage.getItem(STORAGE_KEY) || 'ar';

  var strings = {
    // ── App ──
    app_name: { ar: 'نواة POS', en: 'Nawa POS' },
    company_name: { ar: 'شركة نواة', en: 'Nawa Company' },
    version: { ar: 'الإصدار', en: 'Version' },

    // ── Auth / Login ──
    login: { ar: 'تسجيل الدخول', en: 'Login' },
    logout: { ar: 'تسجيل الخروج', en: 'Logout' },
    username: { ar: 'اسم المستخدم', en: 'Username' },
    password: { ar: 'كلمة المرور', en: 'Password' },
    login_button: { ar: 'دخول', en: 'Sign In' },
    login_error: { ar: 'اسم المستخدم أو كلمة المرور غير صحيحة', en: 'Invalid username or password' },
    login_error_fields: { ar: 'يرجى إدخال اسم المستخدم وكلمة المرور', en: 'Please enter username and password' },
    login_error_server: { ar: 'حدث خطأ أثناء تسجيل الدخول', en: 'An error occurred during login' },
    login_tagline: { ar: 'نظام نقطة البيع للمطاعم', en: 'Restaurant Point of Sale System' },
    enter_username: { ar: 'أدخل اسم المستخدم', en: 'Enter username' },
    enter_password: { ar: 'أدخل كلمة المرور', en: 'Enter password' },
    session_expired: { ar: 'انتهت صلاحية الجلسة', en: 'Session expired' },
    welcome: { ar: 'مرحباً', en: 'Welcome' },
    logged_in_as: { ar: 'تم الدخول كـ', en: 'Logged in as' },
    role_admin: { ar: 'مدير', en: 'Admin' },
    role_cashier: { ar: 'أمين صندوق', en: 'Cashier' },
    role_superadmin: { ar: 'مدير عام', en: 'Super Admin' },

    // ── Common Actions ──
    save: { ar: 'حفظ', en: 'Save' },
    cancel: { ar: 'إلغاء', en: 'Cancel' },
    delete: { ar: 'حذف', en: 'Delete' },
    edit: { ar: 'تعديل', en: 'Edit' },
    add: { ar: 'إضافة', en: 'Add' },
    search: { ar: 'بحث', en: 'Search' },
    filter: { ar: 'تصفية', en: 'Filter' },
    refresh: { ar: 'تحديث', en: 'Refresh' },
    close: { ar: 'إغلاق', en: 'Close' },
    back: { ar: 'رجوع', en: 'Back' },
    next: { ar: 'التالي', en: 'Next' },
    previous: { ar: 'السابق', en: 'Previous' },
    confirm: { ar: 'تأكيد', en: 'Confirm' },
    yes: { ar: 'نعم', en: 'Yes' },
    no: { ar: 'لا', en: 'No' },
    ok: { ar: 'موافق', en: 'OK' },
    loading: { ar: 'جاري التحميل...', en: 'Loading...' },
    no_data: { ar: 'لا توجد بيانات', en: 'No data available' },
    select: { ar: 'اختيار', en: 'Select' },
    select_all: { ar: 'تحديد الكل', en: 'Select All' },
    actions: { ar: 'الإجراءات', en: 'Actions' },
    status: { ar: 'الحالة', en: 'Status' },
    active: { ar: 'نشط', en: 'Active' },
    inactive: { ar: 'غير نشط', en: 'Inactive' },
    print: { ar: 'طباعة', en: 'Print' },
    export: { ar: 'تصدير', en: 'Export' },
    import: { ar: 'استيراد', en: 'Import' },
    download: { ar: 'تحميل', en: 'Download' },
    upload: { ar: 'رفع', en: 'Upload' },
    settings: { ar: 'الإعدادات', en: 'Settings' },
    language: { ar: 'اللغة', en: 'Language' },
    arabic: { ar: 'العربية', en: 'Arabic' },
    english: { ar: 'الإنجليزية', en: 'English' },

    // ── POS ──
    pos_title: { ar: 'نقطة البيع', en: 'Point of Sale' },
    new_order: { ar: 'طلب جديد', en: 'New Order' },
    current_order: { ar: 'الطلب الحالي', en: 'Current Order' },
    order_summary: { ar: 'ملخص الطلب', en: 'Order Summary' },
    items: { ar: 'الأصناف', en: 'Items' },
    item: { ar: 'صنف', en: 'Item' },
    quantity: { ar: 'الكمية', en: 'Quantity' },
    unit_price: { ar: 'سعر الوحدة', en: 'Unit Price' },
    subtotal: { ar: 'المجموع الفرعي', en: 'Subtotal' },
    tax: { ar: 'الضريبة', en: 'Tax' },
    discount: { ar: 'الخصم', en: 'Discount' },
    total: { ar: 'الإجمالي', en: 'Total' },
    grand_total: { ar: 'الإجمالي الكلي', en: 'Grand Total' },
    add_to_order: { ar: 'إضافة للطلب', en: 'Add to Order' },
    remove_item: { ar: 'إزالة الصنف', en: 'Remove Item' },
    clear_order: { ar: 'مسح الطلب', en: 'Clear Order' },
    hold_order: { ar: 'تعليق الطلب', en: 'Hold Order' },
    recall_order: { ar: 'استرجاع الطلب', en: 'Recall Order' },
    split_bill: { ar: 'تقسيم الفاتورة', en: 'Split Bill' },
    merge_orders: { ar: 'دمج الطلبات', en: 'Merge Orders' },
    cart: { ar: 'السلة', en: 'Cart' },
    cart_empty: { ar: 'السلة فارغة', en: 'Cart is empty' },
    added_to_cart: { ar: 'تمت الإضافة للسلة', en: 'Added to cart' },
    cart_cleared: { ar: 'تم مسح السلة', en: 'Cart cleared' },
    clear_cart: { ar: 'مسح السلة', en: 'Clear Cart' },
    select_table: { ar: 'اختيار طاولة', en: 'Select Table' },
    no_tables: { ar: 'لا توجد طاولات', en: 'No tables available' },
    no_table: { ar: 'بدون طاولة', en: 'No Table' },
    no_products: { ar: 'لا توجد منتجات', en: 'No products found' },
    order_held: { ar: 'تم تعليق الطلب', en: 'Order held' },
    order_submitted: { ar: 'تم إرسال الطلب', en: 'Order submitted' },
    order_cancelled: { ar: 'تم إلغاء الطلب', en: 'Order cancelled' },
    table_transferred: { ar: 'تم نقل الطاولة', en: 'Table transferred' },
    amount_due: { ar: 'المبلغ المستحق', en: 'Amount Due' },
    payment_success: { ar: 'تم الدفع بنجاح', en: 'Payment successful' },
    vat: { ar: 'الضريبة (ضريبة القيمة المضافة)', en: 'VAT' },
    switch_language: { ar: 'تبديل اللغة', en: 'Switch Language' },
    sync_status: { ar: 'حالة المزامنة', en: 'Sync Status' },
    hold: { ar: 'تعليق', en: 'Hold' },
    pay_now: { ar: 'ادفع الآن', en: 'Pay Now' },
    takeaway: { ar: 'تيك أواي', en: 'Takeaway' },
    thank_you: { ar: 'شكراً لزيارتكم', en: 'Thank you for visiting' },
    order_no: { ar: 'رقم الطلب', en: 'Order #' },
    qty: { ar: 'الكمية', en: 'Qty' },
    held_order_loaded: { ar: 'تم تحميل الطلب المعلق', en: 'Held order loaded' },
    print_blocked: { ar: 'تم حظر الطباعة', en: 'Print blocked by browser' },
    confirm_cancel_order: { ar: 'هل تريد إلغاء الطلب؟', en: 'Cancel this order?' },
    sync_complete: { ar: 'تمت المزامنة بنجاح', en: 'Sync complete' },
    error_holding_order: { ar: 'خطأ في تعليق الطلب', en: 'Error holding order' },
    error_submitting_order: { ar: 'خطأ في إرسال الطلب', en: 'Error submitting order' },
    error_processing_payment: { ar: 'خطأ في معالجة الدفع', en: 'Error processing payment' },
    error_transferring_table: { ar: 'خطأ في نقل الطاولة', en: 'Error transferring table' },
    search_products: { ar: 'بحث عن منتجات...', en: 'Search products...' },

    // ── Tables ──
    tables: { ar: 'الطاولات', en: 'Tables' },
    table: { ar: 'طاولة', en: 'Table' },
    table_number: { ar: 'رقم الطاولة', en: 'Table Number' },
    available: { ar: 'متاحة', en: 'Available' },
    occupied: { ar: 'مشغولة', en: 'Occupied' },
    reserved: { ar: 'محجوزة', en: 'Reserved' },
    seats: { ar: 'المقاعد', en: 'Seats' },
    floor: { ar: 'الطابق', en: 'Floor' },
    floor_upper: { ar: 'الطابق العلوي', en: 'Upper Floor' },
    floor_lower: { ar: 'الطابق السفلي', en: 'Lower Floor' },
    floor_terrace: { ar: 'التراس', en: 'Terrace' },
    floor_private: { ar: 'الخاصة', en: 'Private' },

    // ── Payment ──
    payment: { ar: 'الدفع', en: 'Payment' },
    pay: { ar: 'ادفع', en: 'Pay' },
    paid: { ar: 'مدفوع', en: 'Paid' },
    unpaid: { ar: 'غير مدفوع', en: 'Unpaid' },
    payment_method: { ar: 'طريقة الدفع', en: 'Payment Method' },
    cash: { ar: 'نقدي', en: 'Cash' },
    credit_card: { ar: 'بطاقة ائتمان', en: 'Credit Card' },
    debit_card: { ar: 'بطاقة خصم', en: 'Debit Card' },
    mobile_payment: { ar: 'دفع إلكتروني', en: 'Mobile Payment' },
    amount_received: { ar: 'المبلغ المستلم', en: 'Amount Received' },
    change: { ar: 'المبلغ المتبقي', en: 'Change' },
    tip: { ar: 'المبلغ الإضافي', en: 'Tip' },
    receipt: { ar: 'الفاتورة', en: 'Receipt' },
    invoice: { ar: 'فاتورة', en: 'Invoice' },
    vat_number: { ar: 'الرقم الضريبي', en: 'VAT Number' },

    // ── Admin ──
    dashboard: { ar: 'لوحة التحكم', en: 'Dashboard' },
    products: { ar: 'المنتجات', en: 'Products' },
    product: { ar: 'منتج', en: 'Product' },
    product_name: { ar: 'اسم المنتج', en: 'Product Name' },
    product_name_en: { ar: 'الاسم بالإنجليزية', en: 'English Name' },
    price: { ar: 'السعر', en: 'Price' },
    barcode: { ar: 'الباركود', en: 'Barcode' },
    category: { ar: 'الفئة', en: 'Category' },
    categories: { ar: 'الفئات', en: 'Categories' },
    employees: { ar: 'الموظفين', en: 'Employees' },
    employee: { ar: 'موظف', en: 'Employee' },
    employee_name: { ar: 'اسم الموظف', en: 'Employee Name' },
    orders: { ar: 'الطلبات', en: 'Orders' },
    order: { ar: 'طلب', en: 'Order' },
    order_id: { ar: 'رقم الطلب', en: 'Order ID' },
    order_status: { ar: 'حالة الطلب', en: 'Order Status' },
    order_date: { ar: 'تاريخ الطلب', en: 'Order Date' },
    customers: { ar: 'العملاء', en: 'Customers' },
    customer: { ar: 'عميل', en: 'Customer' },
    audit_log: { ar: 'سجل المراجعة', en: 'Audit Log' },
    reports: { ar: 'التقارير', en: 'Reports' },
    sales_report: { ar: 'تقرير المبيعات', en: 'Sales Report' },
    daily_report: { ar: 'التقرير اليومي', en: 'Daily Report' },
    monthly_report: { ar: 'التقرير الشهري', en: 'Monthly Report' },
    revenue: { ar: 'الإيرادات', en: 'Revenue' },
    total_sales: { ar: 'إجمالي المبيعات', en: 'Total Sales' },
    total_orders: { ar: 'عدد الطلبات', en: 'Total Orders' },
    average_order: { ar: 'متوسط الطلب', en: 'Average Order' },
    peak_hours: { ar: 'ساعات الذروة', en: 'Peak Hours' },

    // ── Super Admin ──
    super_admin: { ar: 'المدير العام', en: 'Super Admin' },
    system_settings: { ar: 'إعدادات النظام', en: 'System Settings' },
    database: { ar: 'قاعدة البيانات', en: 'Database' },
    backup: { ar: 'النسخ الاحتياطي', en: 'Backup' },
    restore: { ar: 'الاستعادة', en: 'Restore' },
    reset_data: { ar: 'إعادة تعيين البيانات', en: 'Reset Data' },
    sync_data: { ar: 'مزامنة البيانات', en: 'Sync Data' },
    last_sync: { ar: 'آخر مزامنة', en: 'Last Sync' },
    online: { ar: 'متصل', en: 'Online' },
    offline: { ar: 'غير متصل', en: 'Offline' },
    verify_audit: { ar: 'التحقق من السجل', en: 'Verify Audit' },
    chain_valid: { ar: 'سلسلة التشفير سليمة', en: 'Hash chain is valid' },
    chain_broken: { ar: 'تنبيه: تم العثور على تلاعب بالبيانات', en: 'Warning: Data tampering detected' },
    export_audit: { ar: 'تصدير سجل المراجعة', en: 'Export Audit Log' },

    // ── Categories (demo) ──
    cat_hot_drinks: { ar: 'المشروبات الساخنة', en: 'Hot Drinks' },
    cat_cold_drinks: { ar: 'المشروبات الباردة', en: 'Cold Drinks' },
    cat_main_dishes: { ar: 'الأطباق الرئيسية', en: 'Main Dishes' },
    cat_appetizers: { ar: 'المقبلات', en: 'Appetizers' },
    cat_desserts: { ar: 'الحلويات', en: 'Desserts' },
    cat_addons: { ar: 'الإضافات', en: 'Add-ons' },

    // ── Errors ──
    error_generic: { ar: 'حدث خطأ', en: 'An error occurred' },
    error_not_found: { ar: 'العنصر غير موجود', en: 'Item not found' },
    error_network: { ar: 'خطأ في الاتصال بالشبكة', en: 'Network error' },
    error_db: { ar: 'خطأ في قاعدة البيانات', en: 'Database error' },
    error_permission: { ar: 'ليس لديك صلاحية', en: 'Permission denied' },
    error_validation: { ar: 'يرجى التحقق من البيانات المدخلة', en: 'Please check your input' },
    error_required_field: { ar: 'هذا الحقل مطلوب', en: 'This field is required' },
    error_invalid_format: { ar: 'تنسيق غير صحيح', en: 'Invalid format' },

    // ── Success ──
    success_save: { ar: 'تم الحفظ بنجاح', en: 'Saved successfully' },
    success_delete: { ar: 'تم الحذف بنجاح', en: 'Deleted successfully' },
    success_update: { ar: 'تم التحديث بنجاح', en: 'Updated successfully' },
    success_order: { ar: 'تم إنشاء الطلب بنجاح', en: 'Order created successfully' },
    success_payment: { ar: 'تم الدفع بنجاح', en: 'Payment successful' },
    success_export: { ar: 'تم التصدير بنجاح', en: 'Exported successfully' },
    success_backup: { ar: 'تم النسخ الاحتياطي بنجاح', en: 'Backup created successfully' },
    success_restore: { ar: 'تمت الاستعادة بنجاح', en: 'Restored successfully' },
    success_sync: { ar: 'تمت المزامنة بنجاح', en: 'Sync completed successfully' },
    success_login: { ar: 'تم تسجيل الدخول بنجاح', en: 'Logged in successfully' },

    // ── Confirmations ──
    confirm_delete: { ar: 'هل أنت متأكد من الحذف؟', en: 'Are you sure you want to delete?' },
    confirm_clear_order: { ar: 'هل تريد مسح الطلب الحالي؟', en: 'Clear current order?' },
    confirm_reset_data: { ar: 'سيتم حذف جميع البيانات. هل أنت متأكد؟', en: 'All data will be deleted. Are you sure?' },
    confirm_logout: { ar: 'هل تريد تسجيل الخروج؟', en: 'Do you want to logout?' },
    confirm_payment: { ar: 'تأكيد الدفع؟', en: 'Confirm payment?' },
    confirm_hold: { ar: 'تعليق الطلب الحالي؟', en: 'Hold current order?' },

    // ── Misc ──
    date: { ar: 'التاريخ', en: 'Date' },
    time: { ar: 'الوقت', en: 'Time' },
    today: { ar: 'اليوم', en: 'Today' },
    from: { ar: 'من', en: 'From' },
    to: { ar: 'إلى', en: 'To' },
    all: { ar: 'الكل', en: 'All' },
    none: { ar: 'لا شيء', en: 'None' },
    total_records: { ar: 'إجمالي السجلات', en: 'Total Records' },
    page: { ar: 'صفحة', en: 'Page' },
    of: { ar: 'من', en: 'of' },
    copy: { ar: 'نسخ', en: 'Copy' },
    copied: { ar: 'تم النسخ', en: 'Copied' },
    dark_mode: { ar: 'الوضع الداكن', en: 'Dark Mode' },
    light_mode: { ar: 'الوضع الفاتح', en: 'Light Mode' },
    shape: { ar: 'الشكل', en: 'Shape' },
    round: { ar: 'دائري', en: 'Round' },
    square: { ar: 'مربع', en: 'Square' },
    rectangle: { ar: 'مستطيل', en: 'Rectangle' },

    // ── Admin: Audit ──
    date_time: { ar: 'التاريخ والوقت', en: 'Date & Time' },
    user: { ar: 'المستخدم', en: 'User' },
    details: { ar: 'التفاصيل', en: 'Details' },
    fingerprint: { ar: 'البصمة', en: 'Fingerprint' },
    no_records: { ar: 'لا توجد سجلات', en: 'No records' },
    no_records_desc: { ar: 'لم يتم تسجيل أي تعديلات بعد', en: 'No modifications recorded yet' },
    record_details: { ar: 'تفاصيل السجل:', en: 'Record details:' },
    no_details: { ar: 'لا توجد تفاصيل', en: 'No details' },
    audit_integrity_ok: { ar: 'سجل التعديلات سليم', en: 'Audit log is intact' },
    audit_tampered: { ar: 'تم العثور على تعديلات غير مصرح بها', en: 'Unauthorized modifications detected' },
    audit_tampered_warn: { ar: 'تم العثور على تعديلات مشبوهة في السجل!', en: 'Suspicious modifications found in audit log!' },
    showing_records: { ar: 'عرض', en: 'Showing' },
    records_of: { ar: 'من', en: 'of' },

    // ── Admin: Actions ──
    action_add: { ar: 'إضافة', en: 'Add' },
    action_edit: { ar: 'تعديل', en: 'Edit' },
    action_delete: { ar: 'حذف', en: 'Delete' },
    action_payment: { ar: 'دفع', en: 'Payment' },
    action_auth: { ar: 'مصادقة', en: 'Auth' },
    action_login: { ar: 'تسجيل دخول', en: 'Login' },
    action_logout: { ar: 'تسجيل خروج', en: 'Logout' },
    action_default: { ar: 'إجراء', en: 'Action' },

    // ── Admin: Stores ──
    store_products: { ar: 'المنتجات', en: 'Products' },
    store_orders: { ar: 'الطلبات', en: 'Orders' },
    store_tables: { ar: 'الطاولات', en: 'Tables' },
    store_employees: { ar: 'الموظفين', en: 'Employees' },
    store_categories: { ar: 'الفئات', en: 'Categories' },
    store_settings: { ar: 'الإعدادات', en: 'Settings' },
    store_customers: { ar: 'العملاء', en: 'Customers' },
    store_audit_log: { ar: 'سجل التعديلات', en: 'Audit Log' },
    store_floors: { ar: 'الطوابق', en: 'Floors' },

    // ── Admin: Settings ──
    tax_rate: { ar: 'نسبة الضريبة (%)', en: 'Tax Rate (%)' },
    tax_rate_desc: { ar: 'القيمة الافتراضية 15%', en: 'Default 15%' },
    receipt_header: { ar: 'نص رأس الإيصال', en: 'Receipt Header' },
    receipt_header_desc: { ar: 'يظهر في أعلى الإيصال المطبوع', en: 'Printed at top of receipt' },
    sync_interval: { ar: 'فترة المزامنة (ثانية)', en: 'Sync Interval (seconds)' },
    sync_interval_desc: { ar: 'كمية تكرار المزامنة مع السيرفر', en: 'How often to sync with server' },
    sound_print: { ar: 'الصوت والطباعة', en: 'Sound & Print' },
    sound_effects: { ar: 'المؤثرات الصوتية', en: 'Sound Effects' },
    sound_effects_desc: { ar: 'تشغيل أصوات عند إجراء المعاملات', en: 'Play sounds for transactions' },
    auto_print: { ar: 'الطباعة التلقائية', en: 'Auto Print' },
    auto_print_desc: { ar: 'طباعة الإيصال تلقائياً عند إتمام الطلب', en: 'Auto-print receipt on order completion' },
    save_settings: { ar: 'حفظ الإعدادات', en: 'Save Settings' },

    // ── Admin: CSV Export ──
    csv_header: { ar: 'التاريخ,المستخدم,الإجراء,السجل,البصمة,التفاصيل', en: 'Date,User,Action,Record,Fingerprint,Details' },

    // ── POS: Cashier ──
    qty_label: { ar: 'الكمية', en: 'Qty' },
    price_label: { ar: 'السعر', en: 'Price' },
    tax_label: { ar: 'الضريبة', en: 'Tax' },
    discount_label: { ar: 'الخصم', en: 'Discount' },
    empty_cart_msg: { ar: 'ابدأ بإضافة منتجات من القائمة', en: 'Start adding products from the menu' },
    add_items_btn: { ar: 'إضافة أصناف', en: 'Add Items' },
    cart_items_label: { ar: 'أصناف في السلة', en: 'items in cart' },
    pay_btn: { ar: 'دفع', en: 'Pay' },
    hold_btn: { ar: 'تعليق', en: 'Hold' },
    remove_btn: { ar: 'إزالة', en: 'Remove' },
    payment_method_cash: { ar: 'نقدي', en: 'Cash' },
    payment_title: { ar: 'الدفع', en: 'Payment' },
    amount_received_label: { ar: 'المبلغ المستلم', en: 'Amount Received' },
    change_label: { ar: 'المتبقي', en: 'Change' },
    confirm_payment_btn: { ar: 'تأكيد الدفع', en: 'Confirm Payment' },
    order_submitted_msg: { ar: 'تم إرسال الطلب بنجاح', en: 'Order submitted successfully' },
    scan_or_search: { ar: 'امسح الباركود أو ابحث...', en: 'Scan barcode or search...' },
    all_categories: { ar: 'الكل', en: 'All' },
    takeaway_label: { ar: 'تيك أواي', en: 'Takeaway' },
    new_order_btn: { ar: 'طلب جديد', en: 'New Order' },
    receipt_print: { ar: 'طباعة الإيصال', en: 'Print Receipt' },
    receipt_done: { ar: 'تم', en: 'Done' },
    order_no_label: { ar: 'رقم الطلب', en: 'Order #' },
    table_label: { ar: 'الطاولة', en: 'Table' },
    cashier_label: { ar: 'أمين الصندوق', en: 'Cashier' },
    date_label: { ar: 'التاريخ', en: 'Date' },

    // ── Admin: Employees ──
    no_employees: { ar: 'لا يوجد موظفين', en: 'No employees' },
    completed_orders: { ar: 'الطلبات المنجزة', en: 'Completed Orders' },
    total_sales: { ar: 'إجمالي المبيعات', en: 'Total Sales' },
    deactivate: { ar: 'تعطيل', en: 'Deactivate' },
    activate: { ar: 'تفعيل', en: 'Activate' },
    role: { ar: 'الدور', en: 'Role' },
    is_active: { ar: 'نشط', en: 'Active' },
    is_inactive: { ar: 'غير نشط', en: 'Inactive' },
    created_at: { ar: 'تاريخ الإنشاء', en: 'Created' },
    add_employee: { ar: 'إضافة موظف', en: 'Add Employee' },
    employee_username: { ar: 'اسم المستخدم', en: 'Username' },
    employee_password: { ar: 'كلمة المرور', en: 'Password' },
    employee_role: { ar: 'الدور', en: 'Role' },
    role_cashier: { ar: 'كاشير', en: 'Cashier' },
    role_admin: { ar: 'مدير', en: 'Admin' },
    employee_name_en: { ar: 'الاسم بالإنجليزية', en: 'English Name' },
    employee_added: { ar: 'تم إضافة الموظف بنجاح', en: 'Employee added successfully' },
    employee_add_error: { ar: 'فشل إضافة الموظف', en: 'Failed to add employee' },
    required_field: { ar: 'هذا الحقل مطلوب', en: 'This field is required' },

    // ── Admin: Order Modal ──
    order_details: { ar: 'تفاصيل الطلب', en: 'Order Details' },
    item_name: { ar: 'صنف', en: 'Item' },
    subtotal_label: { ar: 'المجموع الفرعي', en: 'Subtotal' },
    tax_label_admin: { ar: 'الضريبة', en: 'Tax' },
    total_label: { ar: 'الإجمالي', en: 'Total' },
    payment_method_label: { ar: 'طريقة الدفع', en: 'Payment Method' },
    payment_card: { ar: 'بطاقة', en: 'Card' },
    payment_cash_label: { ar: 'نقدي', en: 'Cash' },
    close_btn: { ar: 'إغلاق', en: 'Close' },

    // ── Admin: Dashboard ──
    main_menu: { ar: 'القائمة الرئيسية', en: 'Main Menu' },
    sales_last_7: { ar: 'المبيعات خلال آخر 7 أيام', en: 'Sales - Last 7 Days' },
    orders_by_hour: { ar: 'الطلبات حسب الساعة', en: 'Orders by Hour' },
    top_selling: { ar: 'أكثر المنتجات مبيعاً', en: 'Top Selling Products' },
    payment_methods: { ar: 'طرق الدفع', en: 'Payment Methods' },
    recent_orders: { ar: 'آخر الطلبات', en: 'Recent Orders' },
    no_orders_yet: { ar: 'لا توجد طلبات بعد', en: 'No orders yet' },
    orders_appear: { ar: 'ستظهر الطلبات هنا بعد إتمامها', en: 'Orders will appear here once completed' },
    no_data: { ar: 'لا توجد بيانات', en: 'No data' },
    all_users: { ar: 'جميع المستخدمين', en: 'All Users' }
  };

  function setDirection(lang) {
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
    document.body.style.fontFamily = lang === 'ar' ? 'Tajawal, sans-serif' : 'Inter, sans-serif';
    // Update page title
    document.title = lang === 'ar' ? 'نواة POS - نظام نقطة البيع' : 'Nawa POS - Point of Sale';
  }

  var I18n = {
    setLang: function (lang) {
      currentLang = lang;
      localStorage.setItem(STORAGE_KEY, lang);
      setDirection(lang);
    },

    getLang: function () {
      return currentLang;
    },

    t: function (key) {
      var entry = strings[key];
      if (!entry) return key;
      return entry[currentLang] || entry['en'] || key;
    },

    toggle: function () {
      this.setLang(currentLang === 'ar' ? 'en' : 'ar');
      return currentLang;
    },

    getAllKeys: function () {
      return Object.keys(strings);
    }
  };

  setDirection(currentLang);

  window.Nawa = window.Nawa || {};
  window.Nawa.I18n = I18n;
})();
