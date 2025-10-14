require('dotenv').config();
const express = require("express");
const compression = require("compression");
const multer = require("multer");
const multerS3 = require("multer-s3");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const port = process.env.PORT || 3000;
const bodyParser = require("body-parser");
const db = require('./db'); // Import MySQL connection
const session = require('express-session');
const { log, error } = require("console");

// Configure AWS S3 Client (v3)
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1'
});

console.log('S3 Client initialized with region:', process.env.AWS_REGION || 'us-east-1');
console.log('S3 Bucket:', process.env.S3_BUCKET_NAME || 'jengapizza-uploads-202501');

// Configure multer to use memory storage (แทน multer-s3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // จำกัด 5MB
  }
});

// Creating the Express server
const app = express();

// S3 Bucket URL for images
const S3_BUCKET_URL = process.env.S3_BUCKET_URL || '';

// Enable gzip compression for all responses
app.use(compression());

// Middleware to make S3_BUCKET_URL available in all views
app.use((req, res, next) => {
  res.locals.S3_BUCKET_URL = S3_BUCKET_URL;
  next();
});

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: true,
  saveUninitialized: true,
  cookie: {
    expires: 7200000
  }
}));

app.use(express.json());

app.use(bodyParser.urlencoded({ extended: true }));

// Static resources with caching
app.use(express.static("views", {
  maxAge: '1d', // Cache static files for 1 day
  etag: true,
  lastModified: true
}));

// Set EJS as templating engine
app.set("view engine", "ejs");

// Health check endpoint for Load Balancer
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get("/", (req, res) => {
  res.redirect('home');
});

app.get("/home", (req, res) => {
  res.render('home', { loggedin: req.session.loggedin, username: req.session.username, user_privilege: req.session.user_privilege || "" });
});

app.get("/choose", (req, res) => {
  if (req.session.loggedin) {
    res.render('choose', { loggedin: req.session.loggedin, username: req.session.username, user_privilege: req.session.user_privilege || "" });
  } else {
    res.redirect('/home?nli=true');
  }
});

app.post("/complete_order", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "กรุณาอัปโหลดหลักฐานการชำระเงิน" });
  }

  try {
    // สร้างชื่อไฟล์
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(req.file.originalname);
    const key = `uploads/order-${uniqueSuffix}${ext}`;
    
    const bucketName = process.env.S3_BUCKET_NAME || 'jengapizza-uploads-202501';
    const region = process.env.AWS_REGION || 'us-east-1';

    console.log("Attempting to upload to S3:", {
      bucket: bucketName,
      key: key,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
    
    // Upload ไปยัง S3 ด้วย PutObjectCommand
    const uploadParams = {
      Bucket: bucketName,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    };

    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);

    // สร้าง URL
    const payment_proof = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

    console.log("File uploaded to S3 successfully:", payment_proof);

    // บันทึกลงฐานข้อมูล
    const complete_query =
      `UPDATE orders
      SET payment_proof = ?, order_status = "pending"
      WHERE order_status = "pending" AND user_id = ?`;

    await new Promise((resolve, reject) => {
      db.run(complete_query, [payment_proof, req.session.user_id], (error) => (error ? reject(error) : resolve()));
    });

    console.log("Payment proof saved to database:", payment_proof);

    res.json({
      message: "อัปโหลดหลักฐานการชำระเงินสำเร็จ รอการตรวจสอบจากทางร้าน",
      filename: key,
      path: payment_proof,
      redirect: '/tracking'
    });

  } catch (error) {
    console.error("Complete order error:", error);
    console.error("Error name:", error.name);
    console.error("Error code:", error.code);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      message: "เกิดข้อผิดพลาดในการอัปโหลด: " + error.message,
      errorCode: error.code,
      errorName: error.name,
      redirect: '/qrpayment' 
    });
  }
});

app.get("/category", async (req, res) => {
  let sql = "";
  let etc_query = "";
  if (req.session.loggedin) {
    sql =
      `SELECT pizza_id, pizza_name, price FROM pizzas
    LEFT JOIN (SELECT pizza_id, ingredient_id, SUM(quantity_required) AS \`require\`, stock_quantity FROM pizza_ingredients
    JOIN ingredients USING (ingredient_id)
    WHERE ingredient_id >= 21
    GROUP BY pizza_id, ingredient_id
    HAVING \`require\` > stock_quantity
    ) AS subquery USING (pizza_id)
    LEFT JOIN (SELECT item_id FROM orders
    JOIN order_items USING (order_id)
    WHERE item_type = "pizza" AND user_id = ? AND order_status = "pending")
    AS cart ON item_id = pizza_id
    WHERE ingredient_id IS NULL AND (user_id = ? OR user_id = 1) AND item_id IS NULL
    ORDER BY user_id`

    etc_query =
      `SELECT * FROM etc
    LEFT JOIN (SELECT item_id FROM orders
    JOIN order_items USING (order_id)
    WHERE order_status = "pending" AND item_type = "etc" AND user_id = ?)
    AS cart ON item_id = etc_id
    WHERE stock_quantity > 0 AND item_id IS NULL`
  } else {
    sql =
      `SELECT pizza_id, pizza_name, price FROM pizzas
    LEFT JOIN (SELECT pizza_id, ingredient_id, SUM(quantity_required) AS \`require\`, stock_quantity FROM pizza_ingredients
    JOIN ingredients USING (ingredient_id)
    WHERE ingredient_id >= 21
    GROUP BY pizza_id, ingredient_id
    HAVING \`require\` > stock_quantity
    ) AS subquery USING (pizza_id)
    LEFT JOIN (SELECT item_id FROM orders
    JOIN order_items USING (order_id)
    WHERE item_type = "pizza" AND user_id = "1" AND order_status = "pending")
    AS cart ON item_id = pizza_id
    WHERE ingredient_id IS NULL AND user_id = 1 AND item_id IS NULL
    ORDER BY user_id`

    etc_query = "SELECT * FROM etc WHERE stock_quantity > 0";
  }
  let ingredient_query = `SELECT ingredient_id, ingredient_name, stock_quantity, thai_name FROM ingredients
                          WHERE ingredient_name NOT LIKE '%\\_%' AND stock_quantity > 0;`
  let pizza_results = "";
  let etc_results = "";
  let ingredient_results = "";
  try {
    if (req.session.loggedin) {
      pizza_results = await new Promise((resolve, reject) => {
        db.all(sql, [req.session.user_id, req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
      })
      etc_results = await new Promise((resolve, reject) => {
        db.all(etc_query, [req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
      })
    } else {
      pizza_results = await new Promise((resolve, reject) => {
        db.all(sql, (error, rows) => (error ? reject(error) : resolve(rows)));
      })
      etc_results = await new Promise((resolve, reject) => {
        db.all(etc_query, (error, rows) => (error ? reject(error) : resolve(rows)));
      })
    }

    ingredient_results = await new Promise((resolve, reject) => {
      db.all(ingredient_query, (error, rows) => (error ? reject(error) : resolve(rows)));
    })

    res.render('category', {
      loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "",
      pizza_item: pizza_results, etc_item: etc_results, ingredient_item: ingredient_results
    });

  } catch (error) {
    console.error(error.message);
    res.render('category', {
      loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "",
      pizza_item: [], etc_item: [], ingredient_item: []
    });
  }

});

app.get("/pizza-:pizza_id", (req, res) => {
  const pizza_id = parseInt(req.params.pizza_id);
  
  // Validate pizza_id is a number
  if (isNaN(pizza_id) || pizza_id <= 0) {
    return res.render('pizza-name', { 
      loggedin: req.session.loggedin, 
      username: req.session.username || "", 
      user_privilege: req.session.user_privilege || "", 
      item: [{ pizza_name: 'ไม่พบข้อมูล', ingredient_name: 'ไม่พบข้อมูล' }] 
    });
  }
  
  // Use parameterized query
  const sql = `SELECT pizza_id, pizza_name, thai_name, price FROM pizzas
              JOIN pizza_ingredients USING (pizza_id)
              JOIN ingredients USING (ingredient_id)
              WHERE pizza_id = ?
              ORDER BY ingredient_id`;

  db.all(sql, [pizza_id], (error, results) => {
    if (error) {
      console.error("Pizza query error:", error.message);
      res.render('pizza-name', { 
        loggedin: req.session.loggedin, 
        username: req.session.username || "", 
        user_privilege: req.session.user_privilege || "", 
        item: [{ pizza_name: 'เจ๊ง', ingredient_name: 'เจ๊ง' }] 
      });
    } else {
      res.render('pizza-name', { 
        loggedin: req.session.loggedin, 
        username: req.session.username || "", 
        user_privilege: req.session.user_privilege || "", 
        item: results 
      });
    }
  });
});

app.get("/etc-:etc_id", (req, res) => {
  const etc_id = parseInt(req.params.etc_id);
  
  // Validate etc_id is a number
  if (isNaN(etc_id) || etc_id <= 0) {
    return res.render('etc-name', { 
      loggedin: req.session.loggedin, 
      username: req.session.username || "", 
      user_privilege: req.session.user_privilege || "", 
      item: [{ etc_name: 'ไม่พบข้อมูล', price: '0' }] 
    });
  }
  
  // Use parameterized query
  const sql = `SELECT * FROM etc WHERE etc_id = ?`;

  db.all(sql, [etc_id], (error, results) => {
    if (error) {
      console.error("Etc query error:", error.message);
      res.render('etc-name', { 
        loggedin: req.session.loggedin, 
        username: req.session.username || "", 
        user_privilege: req.session.user_privilege || "", 
        item: [{ etc_name: 'เจ๊ง', price: 'เจ๊ง' }] 
      });
    } else {
      res.render('etc-name', { 
        loggedin: req.session.loggedin, 
        username: req.session.username || "", 
        user_privilege: req.session.user_privilege || "", 
        item: results 
      });
    }
  });
});

app.post("/authen", async (req, res) => {
  const { username, password } = req.body;
  
  // Input validation
  if (!username || !password) {
    return res.json({ success: false, message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
  }
  
  // Use parameterized query to prevent SQL injection
  const sql = `SELECT * FROM users WHERE (username = ? OR user_email = ?) AND user_password = ?`;
  
  db.all(sql, [username, username, password], (error, results) => {
    if (error) {
      console.error("Login error:", error.message);
      return res.json({ success: false, message: "เกิดข้อผิดพลาดในระบบ" });
    }
    
    if (results.length > 0) {
      req.session.loggedin = true;
      req.session.username = results[0].username;
      req.session.user_id = results[0].user_id;
      req.session.user_privilege = results[0].user_privilege;
      console.log("User logged in:", results[0].username);
      return res.json({ success: true, redirect: '/home' });
    } else {
      return res.json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }
  });
});

app.post("/newuser", async (req, res) => {
  const { username, email, password } = req.body;
  
  // Input validation
  if (!username || !email || !password) {
    return res.json({ success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }
  
  if (password.length < 6) {
    return res.json({ success: false, message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
  }
  
  // Use parameterized query to prevent SQL injection
  const check_sql = `SELECT * FROM users WHERE username = ? OR user_email = ?`;
  
  db.all(check_sql, [username, email], (error, results) => {
    if (error) {
      console.error("Registration check error:", error.message);
      return res.json({ success: false, message: "เกิดข้อผิดพลาดในระบบ" });
    }
    
    if (results.length > 0) {
      return res.json({ success: false, message: "ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้ไปแล้ว" });
    } else {
      // Use parameterized query for insert
      const insert_sql = `INSERT INTO users (username, user_email, user_password, user_privilege) VALUES (?, ?, ?, ?)`;
      
      db.run(insert_sql, [username, email, password, "customer"], function(error) {
        if (error) {
          console.error("Registration insert error:", error.message);
          return res.json({ success: false, message: "เกิดข้อผิดพลาดในการสร้างบัญชี" });
        }
        console.log("User created:", username);
        return res.json({ success: true, redirect: '/home' });
      });
    }
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  console.log("logged out!");
  res.redirect('/home');
});

app.get("/orderform", (req, res) => {
  if (req.session.loggedin) {
    res.render('orderform', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "" });
  } else {
    res.redirect('/home?nli=true');
  }
});

app.get("/createform", (req, res) => {
  if (req.session.loggedin) {
    res.render('createform', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "" });
  } else {
    res.redirect('/home?nli=true');
  }
});

app.post("/create", async (req, res) => {
  const { pizza_name, dough, size, sauce, topping } = req.body;
  
  // Input validation
  if (!pizza_name || !dough || !size || !sauce) {
    return res.status(400).send("ข้อมูลไม่ครบถ้วน");
  }
  
  const price = price_calc(dough, size, topping);
  
  // Use parameterized query
  const sql = `INSERT INTO pizzas (pizza_name, price, user_id) VALUES (?, ?, ?)`;
  
  db.run(sql, [pizza_name, price, req.session.user_id], function(error) {
    if (error) {
      console.error("Pizza creation error:", error.message);
      return res.status(500).send("เกิดข้อผิดพลาดในการสร้างพิซซ่า");
    }
    
    // Use insertId instead of lastID for MySQL
    console.log("Pizza Created! ID:", this.insertId);
    
    // Add ingredients with the pizza_name
    topping_adder(`${dough}_${size}`, pizza_name);
    topping_adder(sauce, pizza_name);
    
    if (typeof (topping) == "string") {
      topping_adder(topping, pizza_name);
    } else if (Array.isArray(topping)) {
      topping.forEach((item) => {
        topping_adder(item, pizza_name);
      });
    }
    
    res.redirect("/category");
  });
});

// Note: No longer need to serve uploads folder as static files
// All uploads are now stored in S3 bucket

app.get("/orderlist", async (req, res) => {
  if (!req.session.loggedin) {
    return res.redirect('/home?nli=true');
  }

  const sql = `SELECT order_id, item_id, item_type, quantity FROM orders JOIN order_items USING (order_id) WHERE user_id = ? AND order_status = "pending";`;

  try {
    const results = await new Promise((resolve, reject) => {
      db.all(sql, [req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
    });


    const menu_order = await Promise.all(results.map(async (item) => {
      if (item.item_type === 'pizza') {
        const select_sql = `SELECT pizza_name, GROUP_CONCAT(thai_name, ', ' ORDER BY ingredient_id) AS thai_name, price, pizza_id
                            FROM pizzas
                            JOIN pizza_ingredients USING (pizza_id)
                            JOIN ingredients USING (ingredient_id)
                            WHERE pizza_id = ?
                            ORDER BY ingredient_id;`;

        const pizza = await new Promise((resolve, reject) => {
          db.all(select_sql, [item.item_id], (error, rows) => (error ? reject(error) : resolve(rows)));
        });
        pizza[0].order_id = item.order_id;
        pizza[0].quantity = item.quantity;
        pizza[0].type = item.item_type;
        return pizza[0];
      } else if (item.item_type === 'etc') {
        const select_sql = `SELECT etc_name, price, etc_id
                            FROM etc
                            WHERE etc_id = ?
                            ORDER BY etc_id;`;

        const pizza = await new Promise((resolve, reject) => {
          db.all(select_sql, [item.item_id], (error, rows) => (error ? reject(error) : resolve(rows)));
        });
        pizza[0].order_id = item.order_id;
        pizza[0].quantity = item.quantity;
        pizza[0].type = item.item_type;
        return pizza[0];
      }
    }));

    res.render('orderlist', {
      loggedin: req.session.loggedin,
      username: req.session.username || "",
      user_privilege: req.session.user_privilege || "",
      menu: menu_order.filter(Boolean)
    });

  } catch (error) {
    console.error(error.message);
    res.render('orderlist', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "", menu: [] });
  }
});


app.get("/tracking", async (req, res) => {
  if (req.session.loggedin) {
    let order_results = "";
    try {
      let order_query =
        `SELECT order_id, total_price, order_status, payment_proof, receiver_name, house_no, village_no, street, sub_district, district, province, postal_code, country FROM orders
        JOIN user_address
        USING (user_id)
        WHERE user_id = ? AND payment_proof IS NOT NULL
        ORDER BY order_id DESC`

      order_results = await new Promise((resolve, reject) => {
        db.all(order_query, [req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
      })

    } catch (error) {
      console.log(error)
      res.redirect('404');
    }
    res.render('tracking', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "", order: order_results });
  } else {
    res.redirect('/home?nli=true');
  }
});

app.get("/tracking_seller", async (req, res) => {
  if (req.session.loggedin && (req.session.user_privilege == "admin" || req.session.user_privilege == "employee")) {
    let order_results = "";
    try {
      let order_query =
        `SELECT order_id, user_id, total_price, order_status, payment_proof, receiver_name, house_no, village_no, street, sub_district, district, province, postal_code, country FROM orders
        JOIN user_address
        USING (user_id)
        WHERE payment_proof IS NOT NULL
        ORDER BY 
          CASE 
            WHEN order_status = 'pending' THEN 1
            WHEN order_status = 'preparing' THEN 2
            WHEN order_status = 'delivering' THEN 3
            ELSE 4
          END,
          order_id DESC`

      order_results = await new Promise((resolve, reject) => {
        db.all(order_query, (error, rows) => (error ? reject(error) : resolve(rows)));
      })

    } catch (error) {
      console.log(error)
      res.redirect('404');
    }
    res.render('tracking_seller', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "", allder: order_results});
  } else {
    res.redirect('/home?nli=true');
  }
});

app.get("/customerinfo", async (req, res) => {
  if (req.session.loggedin) {
    const sql = `SELECT * FROM user_address WHERE user_id = ?;`

    let pizza_query =
      `SELECT quantity, pizza_name, order_id, address_id, item_type, item_id, price_per_unit, (price_per_unit * quantity) AS total FROM orders
    JOIN order_items
    USING (order_id)
    JOIN pizzas
    ON item_id = pizza_id 
    WHERE order_status = "pending" AND orders.user_id = ? AND item_type = "pizza"
    ORDER BY pizza_id`;

    let etc_query =
      `SELECT quantity, etc_name, order_id, address_id, item_type, item_id, price_per_unit, (price_per_unit * quantity) AS total FROM orders
    JOIN order_items
    USING (order_id)
    JOIN etc
    ON item_id = etc_id 
    WHERE order_status = "pending" AND orders.user_id = ? AND item_type = "etc"
    ORDER BY etc_id`;

    let sql_results = "";
    let pizza_results = "";
    let etc_results = "";

    try {
      sql_results = await new Promise((resolve, reject) => {
        db.all(sql, [req.session.user_id], (error, result) => (error ? reject(error) : resolve(result)));
      })

      pizza_results = await new Promise((resolve, reject) => {
        db.all(pizza_query, [req.session.user_id], (error, result) => (error ? reject(error) : resolve(result)));
      })

      etc_results = await new Promise((resolve, reject) => {
        db.all(etc_query, [req.session.user_id], (error, result) => (error ? reject(error) : resolve(result)));
      })

      let total_price = 0;
      for (var i = 0; i < pizza_results.length; i++) {
        total_price += parseFloat(pizza_results[i].total) || 0;
      }
      for (var i = 0; i < etc_results.length; i++) {
        total_price += parseFloat(etc_results[i].total) || 0;
      }

      // console.log("Calculated total_price:", total_price);
      // console.log("Pizza results:", pizza_results);
      // console.log("Etc results:", etc_results);

      if (sql_results.length > 0) {

        res.render('customerinfo', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "", address: sql_results[0], tag: "disabled", pizza_item: pizza_results, etc_item: etc_results, grand_price: total_price });
      } else {
        res.render('customerinfo', {
          loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "", address: {
            address_id: "",
            user_id: "",
            receiver_name: "",
            phone_no: "",
            house_no: "",
            village_no: "",
            street: "",
            sub_district: "",
            district: "",
            province: "",
            postal_code: "",
          },
          tag: "", pizza_item: pizza_results, etc_item: etc_results, grand_price: total_price
        });
      }
    } catch (error) {
      console.error(error.message);
      res.redirect('404');
    }

  } else {
    res.redirect('/home?nli=true');
  }
});

app.post("/new_address", async (req, res) => {
  const { receiver_name,
    phone_no,
    house_no,
    village_no,
    street,
    sub_district,
    district,
    province,
    postal_code,
    tag,
    grand_price } = req.body;
  try {
    if (tag != "disabled") {
      const sql = `INSERT INTO user_address (user_id, receiver_name,
    phone_no,
    house_no,
    village_no,
    street,
    sub_district,
    district,
    province,
    postal_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

      const insert_address = await new Promise((resolve, reject) => {
        db.run(sql, [req.session.user_id, receiver_name, phone_no, house_no, village_no, street, sub_district, district, province, postal_code], (error) => (error ? reject(error) : resolve()));
      })
      console.log("Address added!");
    }

    const testql = await new Promise((resolve, reject) => {
      db.all(`SELECT address_id FROM user_address WHERE user_id = ?`, [req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
    })

    const update_query =
      `UPDATE orders
    SET total_price = ?, address_id = ?
    WHERE order_status = "pending" AND user_id = ?`;

    const update_total_price = await new Promise((resolve, reject) => {
      db.run(update_query, [grand_price, testql[0].address_id, req.session.user_id], (error) => (error ? reject(error) : resolve()));
    })


    res.redirect("/qrpayment");
  } catch (error) {
    console.log(error)
    res.redirect('404');
  }
});

app.get("/qrpayment", async (req, res) => {
  if (req.session.loggedin) {

    let order_query =
      `SELECT order_id, total_price FROM orders
    WHERE order_status = "pending" AND user_id = ?`

    try {
      order_results = await new Promise((resolve, reject) => {
        db.all(order_query, [req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
      })

      res.render('qrpayment', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "", order_id: order_results[0].order_id, total_price: order_results[0].total_price });
    } catch (error) {
      console.log(error);
      res.redirect('404');
    }
  } else {
    res.redirect('/home?nli=true');
  }
});

// Updated ingredients seller route to fetch all necessary data including 2 tables (etc and ingredient)
app.get("/ingredients_seller", (req, res) => {
  if (req.session.user_privilege == "admin" || req.session.user_privilege == "employee") {
    // Get ingredients data
    const ingredientSql = `SELECT ingredient_id, ingredient_name, stock_quantity, thai_name, unit FROM ingredients
                WHERE ingredient_name NOT LIKE '%\\_%';`;

    // Get etc data
    const etcSql = `SELECT etc_id, etc_name, stock_quantity, price FROM etc;`;

    // Get ingredients data
    db.all(ingredientSql, (ingredientError, ingredientResults) => {
      if (ingredientError) {
        console.log("Ingredient error:", ingredientError.message);
        ingredientResults = [];
      }

      // Get etc data
      db.all(etcSql, (etcError, etcResults) => {
        if (etcError) {
          console.log("Etc error:", etcError.message);
          etcResults = [];
        }

        // Render the page with both data sets
        res.render('ingredients_seller', {
          loggedin: req.session.loggedin,
          username: req.session.username || "",
          user_privilege: req.session.user_privilege || "",
          ingredient: ingredientResults,
          etc: etcResults
        });
        // debug data
        // console.log(ingredientResults);
        // console.log(etcResults);

      });
    });
  } else {
    res.redirect("/home?nli=true");
  }
});

// Enhanced route to handle inventory updates for both ingredients and etc tables
app.post("/update-stock", (req, res) => {
  if (req.session.user_privilege !== "admin" && req.session.user_privilege !== "employee") {
    return res.status(403).send("Access denied");
  }

  const { ingredient_id, etc_id, quantity, operation, current_stock } = req.body;
  const isEtcItem = etc_id ? true : false;

  // Input validation
  if ((!ingredient_id && !etc_id) || !quantity || !operation) {
    return res.status(400).send("Missing required parameters");
  }

  // Convert quantity to number
  const changeAmount = parseInt(quantity);
  if (isNaN(changeAmount) || changeAmount <= 0) {
    return res.status(400).send("Invalid quantity");
  }

  // Set up the appropriate SQL and parameters based on item type
  const itemId = isEtcItem ? etc_id : ingredient_id;
  const tableName = isEtcItem ? 'etc' : 'ingredients';
  const idColumn = isEtcItem ? 'etc_id' : 'ingredient_id';

  // Get current stock from database to ensure we have the latest value
  const checkSql = `SELECT stock_quantity FROM ${tableName} WHERE ${idColumn} = ?`;

  db.get(checkSql, [itemId], (error, result) => {
    if (error) {
      console.error("Database error:", error.message);
      return res.status(500).send("Database error");
    }

    if (!result) {
      return res.status(404).send("Item not found");
    }

    let currentStock = result.stock_quantity;
    let newStock;

    if (operation === "increase") {
      newStock = currentStock + changeAmount;
    } else if (operation === "decrease") {
      if (currentStock < changeAmount) {
        return res.status(400).send("ไม่สามารถลดจำนวนได้ เนื่องจากสินค้าในคลังไม่เพียงพอ");
      }
      newStock = currentStock - changeAmount;
    } else {
      return res.status(400).send("Invalid operation");
    }

    // Update stock in database
    const updateSql = `UPDATE ${tableName} SET stock_quantity = ? WHERE ${idColumn} = ?`;

    db.run(updateSql, [newStock, itemId], function (error) {
      if (error) {
        console.error("Update error:", error.message);
        return res.status(500).send("Update failed");
      }

      console.log(`Stock updated: ${tableName} #${itemId} ${operation}d by ${changeAmount}. New stock: ${newStock}`);

      // Redirect with a query parameter to indicate which tab should be active
      const tabToShow = isEtcItem ? 'etc' : 'ingredient';
      res.redirect(`/ingredients_seller?tab=${tabToShow}`);
    });
  });
});

app.post("/remove_orderitem", async (req, res) => {
  const { order_id, item_id, type, value } = req.body;
  try {
    const remove =
      `DELETE FROM order_items
     WHERE order_id = ? AND item_type = ? AND item_id = ?;`
    db.run(remove, [order_id, type, item_id]);
    res.json({ message: "ส่งมาล้ะแต่", redirect: '/orderlist' });
  } catch (error) {
    res.json({ message: "ส่งมาล้ะแต่ Error", redirect: '/orderlist' });
  }
})

app.post("/update_order", async (req, res) => {
  const { order_id, order_status } = req.body;
  try {
    const update =
      `UPDATE orders
     SET order_status = ?
     WHERE order_id = ?;`
    db.run(update, [order_status, order_id]);
    res.json({ success: "true", redirect: '/tracking_seller' });
  } catch (error) {
    res.json({ success: "false", redirect: '/tracking_seller' });
  }
})

// Admin อนุมัติการชำระเงิน - ลด stock และเปลี่ยน status เป็น "preparing"
app.post("/verify_payment", async (req, res) => {
  const { order_id } = req.body;
  
  if (req.session.user_privilege !== "admin" && req.session.user_privilege !== "employee") {
    return res.status(403).json({ success: false, message: "ไม่มีสิทธิ์เข้าถึง" });
  }

  try {
    // ดึงข้อมูล order items
    const pizza_ingredients_query =
      `SELECT pizza_ingredients.ingredient_id, SUM(quantity * quantity_required) as \`require\`, stock_quantity  
      FROM orders
      JOIN order_items USING (order_id)
      JOIN pizza_ingredients ON (item_id = pizza_id)
      JOIN ingredients ON (pizza_ingredients.ingredient_id = ingredients.ingredient_id)
      WHERE order_id = ? AND item_type = "pizza" AND pizza_ingredients.ingredient_id > 20 AND pizza_ingredients.ingredient_id != 25
      GROUP BY pizza_ingredients.ingredient_id`;

    const etc_query =
      `SELECT etc_id, quantity, stock_quantity 
      FROM orders
      JOIN order_items USING (order_id)
      JOIN etc ON (item_id = etc_id)
      WHERE order_id = ? AND item_type = "etc"`;

    const ingredient_data = await new Promise((resolve, reject) => {
      db.all(pizza_ingredients_query, [order_id], (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const etc_data = await new Promise((resolve, reject) => {
      db.all(etc_query, [order_id], (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    // ตรวจสอบ stock เพียงพอหรือไม่
    for (let item of ingredient_data) {
      if (item.stock_quantity < item.require) {
        return res.json({ 
          success: false, 
          message: `วัตถุดิบไม่เพียงพอ: ${item.ingredient_id}` 
        });
      }
    }

    for (let item of etc_data) {
      if (item.stock_quantity < item.quantity) {
        return res.json({ 
          success: false, 
          message: `สินค้าไม่เพียงพอ: ${item.etc_id}` 
        });
      }
    }

    // ลด stock
    for (let item of ingredient_data) {
      const new_quantity = item.stock_quantity - item.require;
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE ingredients SET stock_quantity = ? WHERE ingredient_id = ?`,
          [new_quantity, item.ingredient_id],
          (error) => (error ? reject(error) : resolve())
        );
      });
    }

    for (let item of etc_data) {
      const new_quantity = item.stock_quantity - item.quantity;
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE etc SET stock_quantity = ? WHERE etc_id = ?`,
          [new_quantity, item.etc_id],
          (error) => (error ? reject(error) : resolve())
        );
      });
    }

    // อัปเดต order status เป็น "preparing"
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE orders SET order_status = "preparing" WHERE order_id = ?`,
        [order_id],
        (error) => (error ? reject(error) : resolve())
      );
    });

    console.log(`Order ${order_id} verified and stock decreased`);
    res.json({ success: true, redirect: '/tracking_seller' });

  } catch (error) {
    console.error("Verify payment error:", error);
    res.json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
});

// Admin ปฏิเสธการชำระเงิน - เปลี่ยน status เป็น "rejected"
app.post("/reject_payment", async (req, res) => {
  const { order_id, reason } = req.body;
  
  if (req.session.user_privilege !== "admin" && req.session.user_privilege !== "employee") {
    return res.status(403).json({ success: false, message: "ไม่มีสิทธิ์เข้าถึง" });
  }

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE orders SET order_status = "rejected" WHERE order_id = ?`,
        [order_id],
        (error) => (error ? reject(error) : resolve())
      );
    });

    console.log(`Order ${order_id} rejected`);
    res.json({ success: true, redirect: '/tracking_seller' });

  } catch (error) {
    console.error("Reject payment error:", error);
    res.json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
});

// ลูกค้ายกเลิก Order (เฉพาะ status = "pending" ที่ยังไม่ถูก approve)
app.post("/cancel_order", async (req, res) => {
  const { order_id } = req.body;
  
  if (!req.session.loggedin) {
    return res.status(403).json({ success: false, message: "กรุณาเข้าสู่ระบบ" });
  }

  try {
    // ตรวจสอบว่า order นี้เป็นของ user และยังเป็น pending อยู่
    const check_query = `SELECT order_id, order_status, user_id FROM orders WHERE order_id = ? AND user_id = ?`;
    
    const order = await new Promise((resolve, reject) => {
      db.get(check_query, [order_id, req.session.user_id], (error, row) => (error ? reject(error) : resolve(row)));
    });

    if (!order) {
      return res.json({ success: false, message: "ไม่พบคำสั่งซื้อ" });
    }

    if (order.order_status !== "pending") {
      return res.json({ success: false, message: "ไม่สามารถยกเลิกคำสั่งซื้อนี้ได้ เนื่องจากทางร้านได้เริ่มดำเนินการแล้ว" });
    }

    // เปลี่ยน status เป็น "cancelled"
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE orders SET order_status = "cancelled" WHERE order_id = ?`,
        [order_id],
        (error) => (error ? reject(error) : resolve())
      );
    });

    console.log(`Order ${order_id} cancelled by customer`);
    res.json({ success: true, message: "ยกเลิกคำสั่งซื้อสำเร็จ", redirect: '/tracking' });

  } catch (error) {
    console.error("Cancel order error:", error);
    res.json({ success: false, message: "เกิดข้อผิดพลาด" });
  }
});

app.post("/update_orderitem", async (req, res) => {
  const { order_id, item_id, type, value } = req.body;
  try {
    const update =
      `UPDATE order_items
     SET quantity = ?
     WHERE order_id = ? AND item_type = ? AND item_id = ?;`
    db.run(update, [value, order_id, type, item_id]);
    res.json({ message: "ส่งมาล้ะแต่" });
  } catch (error) {
    res.json({ message: "ส่งมาล้ะแต่ Error" });
  }
})

app.post("/addtocart", async (req, res) => {
  if (req.session.loggedin) {
    const { item_id, item_type, item_price } = req.body;
    
    // Debug: Log incoming data
    console.log("Received data:", { item_id, item_type, item_price });

    try {
      // Checking if there is a pending order yet, if not create one
      const init_order_status_checking_query =
        `SELECT order_status, order_id, user_id FROM orders
        WHERE order_status = "pending" AND user_id = ?`;
      const init_order_status_checking_results = await new Promise((resolve, reject) => {
        db.all(init_order_status_checking_query, [req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
      });
      if (init_order_status_checking_results.length == 0) {
        const init_the_order =
          `INSERT into orders (user_id)
          VALUES (?)`;
        const init_order_res = await new Promise((resolve, reject) => {
          db.run(init_the_order, [req.session.user_id], (error) => (error ? reject(error) : resolve()));
        });
        console.log("Cart created.");
      }
      const get_order_id_query =
        `SELECT order_id FROM orders
       WHERE order_status = "pending" AND user_id = ?`;
      const order_id_curr = await new Promise((resolve, reject) => {
        db.all(get_order_id_query, [req.session.user_id], (error, rows) => (error ? reject(error) : resolve(rows)));
      });

      // Clean the price value - remove quotes and parse as number
      let cleanPrice = parseFloat(item_price);
      
      // Validate price - if NaN or invalid, throw error
      if (isNaN(cleanPrice) || cleanPrice < 0) {
        console.error("Invalid price:", item_price);
        throw new Error("Invalid price value");
      }
      
      // Parse item_id as integer
      const cleanItemId = parseInt(item_id);
      
      const query_for_add = `INSERT INTO order_items (order_id, item_type, item_id, quantity, price_per_unit)
                             VALUES (?, ?, ?, 1, ?)`;
      const adding = await new Promise((resolve, reject) => {
        db.run(query_for_add, [order_id_curr[0].order_id, item_type, cleanItemId, cleanPrice], (error) => (error ? reject(error) : resolve()));
      });
      console.log("Order Added to cart.");

      res.json({ message: "ส่งมาล้ะ", redirect: '/orderlist' });
    } catch (error) {
      console.error(error.message);
      res.json({ message: "ส่งมาล้ะแต่ Error", redirect: '/orderlist' });
    }
  } else {
    res.json({ message: "ส่งมาล้ะแต่ Error", redirect: '/home?nli=true' });
  }
});


app.get("/aboutus", (req, res) => {
  res.render('aboutus', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "" });
});

app.get("/faq", (req, res) => {
  res.render('faq', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "" });
});

app.get("/dashboard", async (req, res) => {
  // Check if user is admin or employee
  if (!req.session.loggedin || (req.session.user_privilege !== "admin" && req.session.user_privilege !== "employee")) {
    return res.redirect('/home?nli=true');
  }

  try {
    // 1. Summary Statistics
    const totalOrdersQuery = `SELECT COUNT(*) as total FROM orders WHERE payment_proof IS NOT NULL`;
    const totalRevenueQuery = `SELECT IFNULL(SUM(total_price), 0) as revenue FROM orders WHERE payment_proof IS NOT NULL AND order_status = 'success'`;
    const totalCustomersQuery = `SELECT COUNT(*) as total FROM users WHERE user_privilege = 'customer'`;
    const topPizzaQuery = `
      SELECT p.pizza_id, p.pizza_name, SUM(oi.quantity) as total_sold, IFNULL(SUM(oi.quantity * oi.price_per_unit), 0) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      JOIN pizzas p ON oi.item_id = p.pizza_id
      WHERE oi.item_type = 'pizza' AND o.order_status = 'success'
      GROUP BY oi.item_id, p.pizza_id, p.pizza_name
      ORDER BY total_sold DESC
      LIMIT 1`;
    
    // 1.1 Today's Revenue (for progress bar)
    const todayRevenueQuery = `SELECT IFNULL(SUM(total_price), 0) as revenue FROM orders WHERE order_status = 'success' AND DATE(order_date) = CURDATE()`;

    // 2. Order Status Breakdown - Show ALL statuses
    const statusBreakdownQuery = `
      SELECT order_status, COUNT(*) as count 
      FROM orders 
      WHERE payment_proof IS NOT NULL
      GROUP BY order_status`;

    // 3. Best Selling Items (TOP 5)
    const bestSellingQuery = `
      SELECT 
        CASE 
          WHEN item_type = 'pizza' THEN (SELECT pizza_name FROM pizzas WHERE pizza_id = item_id)
          WHEN item_type = 'etc' THEN (SELECT etc_name FROM etc WHERE etc_id = item_id)
        END as item_name,
        item_type,
        SUM(quantity) as total_sold
      FROM order_items
      JOIN orders USING (order_id)
      WHERE order_status = 'success'
      GROUP BY item_type, item_id
      ORDER BY total_sold DESC
      LIMIT 5`;

    // 4. Low Stock Alert (TOP 3 for each category)
    const lowStockIngredientsQuery = `
      SELECT ingredient_name, thai_name, stock_quantity, unit 
      FROM ingredients 
      WHERE ingredient_name NOT LIKE '%\\_%'
      ORDER BY stock_quantity ASC
      LIMIT 3`;

    const lowStockEtcQuery = `
      SELECT etc_name, stock_quantity, 'ชิ้น' as unit
      FROM etc 
      ORDER BY stock_quantity ASC
      LIMIT 3`;

    // 5. Recent Orders
    const recentOrdersQuery = `
      SELECT o.order_id, u.username, o.total_price, o.order_status, o.order_date
      FROM orders o
      JOIN users u ON o.user_id = u.user_id
      WHERE o.payment_proof IS NOT NULL
      ORDER BY o.order_date DESC
      LIMIT 5`;

    // Execute all queries
    const [totalOrders] = await new Promise((resolve, reject) => {
      db.all(totalOrdersQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const [totalRevenue] = await new Promise((resolve, reject) => {
      db.all(totalRevenueQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const [totalCustomers] = await new Promise((resolve, reject) => {
      db.all(totalCustomersQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const topPizza = await new Promise((resolve, reject) => {
      db.all(topPizzaQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const [todayRevenue] = await new Promise((resolve, reject) => {
      db.all(todayRevenueQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const statusBreakdown = await new Promise((resolve, reject) => {
      db.all(statusBreakdownQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const bestSelling = await new Promise((resolve, reject) => {
      db.all(bestSellingQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const lowStockIngredients = await new Promise((resolve, reject) => {
      db.all(lowStockIngredientsQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const lowStockEtc = await new Promise((resolve, reject) => {
      db.all(lowStockEtcQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    const recentOrders = await new Promise((resolve, reject) => {
      db.all(recentOrdersQuery, (error, rows) => (error ? reject(error) : resolve(rows)));
    });

    // Daily goal (can be adjusted - default 5000 baht)
    const dailyGoal = 5000;

    // Create complete status breakdown with all 6 statuses
    const allStatuses = ['pending', 'preparing', 'delivering', 'success', 'cancelled', 'rejected'];
    const statusMap = {};
    statusBreakdown.forEach(status => {
      statusMap[status.order_status] = status.count;
    });
    
    const completeStatusBreakdown = allStatuses.map(status => ({
      order_status: status,
      count: statusMap[status] || 0
    }));

    // Keep ingredients and etc separate (don't combine)
    res.render('dashboard', {
      loggedin: req.session.loggedin,
      username: req.session.username,
      user_privilege: req.session.user_privilege || "",
      stats: {
        totalOrders: totalOrders.total || 0,
        totalRevenue: totalRevenue.revenue || 0,
        totalCustomers: totalCustomers.total || 0,
        topPizza: topPizza.length > 0 ? topPizza[0] : null,
        todayRevenue: todayRevenue.revenue || 0,
        dailyGoal: dailyGoal
      },
      statusBreakdown: completeStatusBreakdown || [],
      bestSelling: bestSelling || [],
      lowStockIngredients: lowStockIngredients || [],
      lowStockEtc: lowStockEtc || [],
      recentOrders: recentOrders || []
    });

  } catch (error) {
    console.error("Dashboard error:", error);
    res.render('dashboard', {
      loggedin: req.session.loggedin,
      username: req.session.username,
      user_privilege: req.session.user_privilege || "",
      stats: { totalOrders: 0, totalRevenue: 0, totalCustomers: 0, topPizza: null, todayRevenue: 0, dailyGoal: 5000 },
      statusBreakdown: [],
      bestSelling: [],
      lowStockIngredients: [],
      lowStockEtc: [],
      recentOrders: [],
      error: "เกิดข้อผิดพลาดในการโหลดข้อมูล"
    });
  }
});

app.all('*', (req, res) => {
  res.render('404', { loggedin: req.session.loggedin, username: req.session.username || "", user_privilege: req.session.user_privilege || "" })
});

app.listen(port, () => {
  console.log(`This Web Server is running on port ${port}`);
});

let price_calc = (dough, size, topping) => {
  var dough_spec = 1;
  var size_spec = 1;

  if (dough == "cheese_crust" || dough == "sausage_crust") {
    var dough_spec = 1.3;
  }

  if (size == "M") {
    var size_spec = 1.4;
  } else if (size == "L") {
    var size_spec = 1.8;
  } else if (size == "XL") {
    var size_spec = 2.2;
  }

  if (typeof (topping) == "string") {
    var price = Math.floor((150 * dough_spec) + (100 * size_spec) + (49));
  } else {
    var price = Math.floor((150 * dough_spec) + (100 * size_spec) + (Math.max(topping.length - 2, 1) * 49));
  }

  return price;
};

let topping_adder = (topping, pizza_name) => {
  var quantity = 50;
  if (topping.search("sauce") != -1) {
    quantity = 250;
  } else if (topping.search("crust") != -1 || topping.search("original") != -1 || topping.search("crispy") != -1) {
    quantity = 1;
  }
  
  // Use parameterized query with subqueries
  const sql2 = `INSERT INTO pizza_ingredients (pizza_id, ingredient_id, quantity_required)
    SELECT 
      (SELECT pizza_id FROM pizzas WHERE pizza_name = ? LIMIT 1) AS pizza_id,
      (SELECT ingredient_id FROM ingredients WHERE ingredient_name = ? LIMIT 1) AS ingredient_id,
      ? AS quantity_required`;
  
  db.run(sql2, [pizza_name, topping, quantity], function(error) {
    if (error) {
      console.error("Topping add error:", error.message);
    }
  });
};
