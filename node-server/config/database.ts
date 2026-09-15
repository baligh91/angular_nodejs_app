import mysql from 'mysql';

const databasePort = Number.parseInt(process.env['DB_PORT'] ?? '3306', 10);
const connectionLimit = Number.parseInt(process.env['DB_CONNECTION_LIMIT'] ?? '10', 10);
const databaseEnabled = process.env['DB_ENABLED'] === 'true';

// Pool partagé : les connexions sont réutilisées au lieu d'en créer une par requête.
export const database = mysql.createPool({
  host: process.env['DB_HOST'] ?? 'localhost',
  port: Number.isNaN(databasePort) ? 3306 : databasePort,
  user: process.env['DB_USER'] ?? 'root',
  password: process.env['DB_PASSWORD'] ?? '',
  database: process.env['DB_NAME'] ?? 'angular_nodejs_app',
  connectionLimit: Number.isNaN(connectionLimit) ? 10 : connectionLimit,
  waitForConnections: true,
});

const createProductsTable = `
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

// Vérifie la configuration au démarrage sans bloquer le serveur Express.
export function checkDatabaseConnection(): void {
  if (!databaseEnabled) {
    console.log('Connexion MySQL désactivée (DB_ENABLED=false)');
    return;
  }

  database.query('SELECT 1', (error) => {
    if (error) {
      const mysqlError = error as Error & { code?: string; errno?: number };
      const details = [mysqlError.code, mysqlError.errno, mysqlError.message]
        .filter(Boolean)
        .join(' - ');
      console.error(`MySQL indisponible${details ? ` (${details})` : ''}`);
      return;
    }

    console.log('Connexion MySQL établie');
    database.query(createProductsTable, (tableError) => {
      if (tableError) {
        console.error(`Création de la table products impossible : ${tableError.message}`);
        return;
      }

      console.log('Table products prête');
    });
  });
}