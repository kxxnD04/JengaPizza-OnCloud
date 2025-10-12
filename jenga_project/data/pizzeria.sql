-- MySQL Database Dump for Pizzeria
-- Disable foreign key checks during import
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

-- Drop tables if they exist
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `pizza_ingredients`;
DROP TABLE IF EXISTS `pizzas`;
DROP TABLE IF EXISTS `user_address`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `ingredients`;
DROP TABLE IF EXISTS `etc`;

-- Table structure for table `etc`
CREATE TABLE `etc` (
  `etc_id` int(11) NOT NULL AUTO_INCREMENT,
  `etc_name` text NOT NULL,
  `stock_quantity` int(11) NOT NULL DEFAULT 0,
  `price` decimal(10,2) NOT NULL CHECK (`price` >= 0),
  PRIMARY KEY (`etc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure for table `ingredients`
CREATE TABLE `ingredients` (
  `ingredient_id` int(11) NOT NULL AUTO_INCREMENT,
  `ingredient_name` varchar(255) NOT NULL UNIQUE,
  `stock_quantity` int(11) NOT NULL DEFAULT 0,
  `unit` varchar(50) NOT NULL DEFAULT 'grams',
  `thai_name` text,
  PRIMARY KEY (`ingredient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure for table `users`
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL UNIQUE,
  `user_email` varchar(255) NOT NULL UNIQUE,
  `user_password` varchar(255) NOT NULL,
  `user_privilege` enum('customer','admin','employee') NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure for table `user_address`
CREATE TABLE `user_address` (
  `address_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `receiver_name` text NOT NULL,
  `phone_no` varchar(20) NOT NULL,
  `house_no` varchar(50) NOT NULL,
  `village_no` varchar(50),
  `street` text,
  `sub_district` text NOT NULL,
  `district` text NOT NULL,
  `province` text NOT NULL,
  `postal_code` varchar(10) NOT NULL,
  `country` varchar(100) NOT NULL DEFAULT 'ประเทศไทย',
  PRIMARY KEY (`address_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure for table `pizzas`
CREATE TABLE `pizzas` (
  `pizza_id` int(11) NOT NULL AUTO_INCREMENT,
  `pizza_name` text NOT NULL,
  `price` decimal(10,2) NOT NULL CHECK (`price` >= 0),
  `user_id` int(11) NOT NULL,
  PRIMARY KEY (`pizza_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure for table `pizza_ingredients`
CREATE TABLE `pizza_ingredients` (
  `pizza_id` int(11) NOT NULL,
  `ingredient_id` int(11) NOT NULL,
  `quantity_required` int(11) NOT NULL,
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`ingredient_id`) ON DELETE CASCADE,
  FOREIGN KEY (`pizza_id`) REFERENCES `pizzas`(`pizza_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure for table `orders`
CREATE TABLE `orders` (
  `order_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `address_id` int(11),
  `total_price` decimal(10,2) NOT NULL DEFAULT 0 CHECK (`total_price` >= 0),
  `payment_method` enum('qr_code') NOT NULL DEFAULT 'qr_code',
  `payment_proof` text,
  `order_status` enum('pending','preparing','delivering','success','cancelled','rejected') NOT NULL DEFAULT 'pending',
  `order_date` timestamp DEFAULT CURRENT_TIMESTAMP,
  `delivery_date` timestamp NULL,
  PRIMARY KEY (`order_id`),
  FOREIGN KEY (`address_id`) REFERENCES `user_address`(`address_id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table structure for table `order_items`
CREATE TABLE `order_items` (
  `order_id` int(11) NOT NULL,
  `item_type` enum('pizza','etc') NOT NULL,
  `item_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL CHECK (`quantity` > 0),
  `price_per_unit` decimal(10,2) NOT NULL CHECK (`price_per_unit` >= 0),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`order_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert data into `etc`
INSERT INTO `etc` VALUES (1,'น้ำเปล่า',20,20.00);
INSERT INTO `etc` VALUES (2,'น้ำอัดลม',18,30.00);
INSERT INTO `etc` VALUES (3,'ไก่ทอด เดวิลวิงส์',20,89.00);
INSERT INTO `etc` VALUES (4,'เฟรนช์ฟรายส์',20,79.00);
INSERT INTO `etc` VALUES (5,'หอมทอด',20,89.00);
INSERT INTO `etc` VALUES (6,'เค้กทีรามิสุ',20,99.00);

-- Insert data into `ingredients`
INSERT INTO `ingredients` VALUES (1,'original_S',10,'unit','หนานุ่ม 10 นิ้ว');
INSERT INTO `ingredients` VALUES (2,'original_M',10,'unit','หนานุ่ม 12 นิ้ว');
INSERT INTO `ingredients` VALUES (3,'original_L',10,'unit','หนานุ่ม 14 นิ้ว');
INSERT INTO `ingredients` VALUES (4,'original_XL',10,'unit','หนานุ่ม 16 นิ้ว');
INSERT INTO `ingredients` VALUES (5,'crispy_S',10,'unit','บางกรอบ 10 นิ้ว');
INSERT INTO `ingredients` VALUES (6,'crispy_M',10,'unit','บางกรอบ 12 นิ้ว');
INSERT INTO `ingredients` VALUES (7,'crispy_L',10,'unit','บางกรอบ 14 นิ้ว');
INSERT INTO `ingredients` VALUES (8,'crispy_XL',10,'unit','บางกรอบ 16 นิ้ว');
INSERT INTO `ingredients` VALUES (9,'cheese_crust_S',10,'unit','ขอบชีส 10 นิ้ว');
INSERT INTO `ingredients` VALUES (10,'cheese_crust_M',10,'unit','ขอบชีส 12 นิ้ว');
INSERT INTO `ingredients` VALUES (11,'cheese_crust_L',10,'unit','ขอบชีส 14 นิ้ว');
INSERT INTO `ingredients` VALUES (12,'cheese_crust_XL',10,'unit','ขอบชีส 16 นิ้ว');
INSERT INTO `ingredients` VALUES (13,'sausage_crust_S',10,'unit','ขอบไส้กรอก 10 นิ้ว');
INSERT INTO `ingredients` VALUES (14,'sausage_crust_M',10,'unit','ขอบไส้กรอก 12 นิ้ว');
INSERT INTO `ingredients` VALUES (15,'sausage_crust_L',10,'unit','ขอบไส้กรอก 14 นิ้ว');
INSERT INTO `ingredients` VALUES (16,'sausage_crust_XL',10,'unit','ขอบไส้กรอก 16 นิ้ว');
INSERT INTO `ingredients` VALUES (17,'signature_sauce',5000,'ml','ซอสซิกเนเจอร์');
INSERT INTO `ingredients` VALUES (18,'marinara_sauce',5000,'ml','ซอสมารีนาร่า');
INSERT INTO `ingredients` VALUES (19,'bbq_sauce',5000,'ml','ซอสบาร์บีคิว');
INSERT INTO `ingredients` VALUES (20,'spicy_sauce',5000,'ml','ซอสเผ็ด');
INSERT INTO `ingredients` VALUES (21,'ham',1000,'grams','แฮม');
INSERT INTO `ingredients` VALUES (22,'cheese',1000,'grams','ชีส');
INSERT INTO `ingredients` VALUES (23,'shrimp',1000,'grams','กุ้ง');
INSERT INTO `ingredients` VALUES (24,'veggie',950,'grams','ผัก');
INSERT INTO `ingredients` VALUES (25,'tomato_sauce',5000,'ml','ซอสมะเขือเทศ');
INSERT INTO `ingredients` VALUES (26,'pineapple',1000,'grams','สับปะรด');
INSERT INTO `ingredients` VALUES (27,'mushroom',1000,'grams','เห็ด');
INSERT INTO `ingredients` VALUES (28,'pepperoni',1000,'grams','เพปเพอโรนี');

-- Insert data into `users`
INSERT INTO `users` VALUES (1,'admin','admin','admin','admin');
INSERT INTO `users` VALUES (2,'Cruz','45403@ben.ac.th','66070158','customer');
INSERT INTO `users` VALUES (3,'Kuhn','66070030@kmitl.ac.th','66070030','employee');
INSERT INTO `users` VALUES (4,'Itim','66070147@mixue.cn','66070147','customer');

-- Insert data into `user_address`
INSERT INTO `user_address` VALUES (1,3,'Tanapat Zai','0878794512','124/117','-','ทิพนิเวศ','เมือง','เมือง','ราชบุรี','70000','ประเทศไทย');
INSERT INTO `user_address` VALUES (2,2,'เต้ บ้านคา','0962519787','333','-','-','บ้านบึง','บ้านคา','ราชบุรี','70180','ประเทศไทย');
INSERT INTO `user_address` VALUES (3,4,'ไอติม มี่เสวี่ย','0544687954','65/5','4','ยาวมา','ลาดกระบัง','ลาดบุรี','ลาดพร้าว','60540','ประเทศไทย');

-- Insert data into `pizzas`
INSERT INTO `pizzas` VALUES (3,'zai',758.00,3);
INSERT INTO `pizzas` VALUES (4,'พิซซ่ามารินารา',379.00,1);
INSERT INTO `pizzas` VALUES (5,'พิซซ่าฮาวาเอี้ยน',522.00,1);
INSERT INTO `pizzas` VALUES (6,'พิซซ่าเวเจเทเรียน',522.00,1);
INSERT INTO `pizzas` VALUES (7,'พิซซ่าเปปเปอร์โรนี',473.00,1);
INSERT INTO `pizzas` VALUES (8,'พิซซ่าซีฟู้ด',428.00,1);
INSERT INTO `pizzas` VALUES (9,'พิซซ่าพาร์ม่าแฮม',477.00,1);

-- Insert data into `pizza_ingredients`
INSERT INTO `pizza_ingredients` VALUES (3,22,50);
INSERT INTO `pizza_ingredients` VALUES (3,18,250);
INSERT INTO `pizza_ingredients` VALUES (3,12,1);
INSERT INTO `pizza_ingredients` VALUES (4,3,1);
INSERT INTO `pizza_ingredients` VALUES (4,18,250);
INSERT INTO `pizza_ingredients` VALUES (4,24,50);
INSERT INTO `pizza_ingredients` VALUES (5,11,1);
INSERT INTO `pizza_ingredients` VALUES (5,19,250);
INSERT INTO `pizza_ingredients` VALUES (5,26,50);
INSERT INTO `pizza_ingredients` VALUES (5,21,50);
INSERT INTO `pizza_ingredients` VALUES (6,24,50);
INSERT INTO `pizza_ingredients` VALUES (6,15,1);
INSERT INTO `pizza_ingredients` VALUES (6,27,50);
INSERT INTO `pizza_ingredients` VALUES (6,17,250);
INSERT INTO `pizza_ingredients` VALUES (7,22,50);
INSERT INTO `pizza_ingredients` VALUES (7,28,50);
INSERT INTO `pizza_ingredients` VALUES (7,11,1);
INSERT INTO `pizza_ingredients` VALUES (7,25,250);
INSERT INTO `pizza_ingredients` VALUES (8,20,250);
INSERT INTO `pizza_ingredients` VALUES (8,23,50);
INSERT INTO `pizza_ingredients` VALUES (8,3,1);
INSERT INTO `pizza_ingredients` VALUES (8,24,50);
INSERT INTO `pizza_ingredients` VALUES (9,7,1);
INSERT INTO `pizza_ingredients` VALUES (9,25,250);
INSERT INTO `pizza_ingredients` VALUES (9,21,50);
INSERT INTO `pizza_ingredients` VALUES (9,24,50);

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;
COMMIT;