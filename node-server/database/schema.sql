CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL,
  reference VARCHAR(100) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  price DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Disponible',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_reference (reference),
  KEY idx_products_category (category),
  KEY idx_products_status (status),
  CONSTRAINT chk_products_price CHECK (price >= 0),
  CONSTRAINT chk_products_status CHECK (status IN ('Disponible', 'Stock faible', 'Rupture'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
