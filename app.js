const express = require('express');
const userRouter = require('./routes/user.routes')
const cookieParser = require('cookie-parser')

const dotenv = require('dotenv');
dotenv.config();

const connectToDB = require('./config/db')
connectToDB();

const indexRouter = require('./routes/index.routes')
const app = express();


app.use(cookieParser())
app.set('view engine', 'ejs')
app.use(express.json())
app.use(express.urlencoded({extended: true}))

app.use('/', indexRouter)
app.use('/user', userRouter)


app.listen(3000, () => {
    console.log('Server is running on port 3000');
})