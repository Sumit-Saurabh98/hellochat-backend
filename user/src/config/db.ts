import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

const connectDB = async () =>{
    const url = process.env.MONGO_URI;
    if(!url){
        throw new Error("MONGO_URI not found");
    }
    try {
        await mongoose.connect(url, {
            dbName: "hellochat"
        });
        console.log("Database connected");
    } catch (error) {
        console.log("Failed to connect to database", error);
        process.exit(1);
    }
}

export default connectDB;