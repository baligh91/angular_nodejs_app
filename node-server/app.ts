import cookieParser from 'cookie-parser';
import express from 'express';
import logger from 'morgan';
import { join } from 'node:path';
import { checkDatabaseConnection } from './config/database.js';
import indexRouter from './routes/index.js';
import usersRouter from './routes/users.js';
import productsRouter from './routes/products.js';

const app = express();

checkDatabaseConnection();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(join(import.meta.dirname, 'public')));

app.use('/api', (request, response, next) => {
	response.header('Access-Control-Allow-Origin', 'http://localhost:4200');
	response.header('Access-Control-Allow-Headers', 'Content-Type');
	response.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	if (request.method === 'OPTIONS') {
		response.sendStatus(204);
		return;
	}
	next();
});

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/api/products', productsRouter);

export default app;