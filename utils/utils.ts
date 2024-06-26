import dotenv from 'dotenv';
import { PublicKey, Account } from '@solana/web3.js';
import { IWallet } from './interfaces';
import bs58 from 'bs58';
import { MONGODB_URI, ENCRYPT_PASSWORD } from '../config'
import mongoose from "mongoose";
import Order, { IOrder } from '../models/order';
import { FilterQuery } from 'mongoose';
import Wallet from '../models/wallet';
import crypto from 'crypto'
import Status from '../models/status';

dotenv.config();

export const getEnv = (varName: any) => {
    const variable = process.env[varName] || '';
    return variable;
}

export async function genWallet(walletNbr: number): Promise<IWallet[]> {
    const wallets: IWallet[] = [];
    for (let i = 0; i < walletNbr; i++) {
        const wallet = new Account();
        const walletPK = new PublicKey(wallet.publicKey).toBase58();
        const walletSK = bs58.encode(Buffer.from(wallet.secretKey));
        wallets.push({ publicKey: walletPK, secretKey: walletSK });
    }
    return wallets;
}

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI)
    } catch (e) {
        console.log("\u001b[1;31m" + 'ERROR ' + "\u001b[0m" + 'DB / CONNEXION ERROR =', e)
    }
}

export async function addOrderToDB(orderId: number, clientAddr: string, tokenAddress: string, botNbr: number, freq: number, duration: number, funding: number, fee: number): Promise<boolean> {
    console.log(`> Saving order #${orderId} to DB...`)
    console.log('-------------------------------------------------------------')
    try {
        await connectDB()
        const newOrder = new Order({
            id: orderId,
            client: clientAddr,
            token: tokenAddress,
            bot: botNbr,
            frequency: freq,
            duration: duration,
            funding: funding,
            fee: fee,
            status: "pending"
        });
        const savedOrder = await newOrder.save()
        if (savedOrder) {
            console.log("\u001b[1;32m" + 'SUCCESS ' + "\u001b[0m" + `order #${orderId} saved to DB`)
            console.log('-------------------------------------------------------------')
        }
        return true;
    } catch (e) {
        console.log("\u001b[1;31m" + 'ERROR ' + "\u001b[0m" + 'DB / SAVING ORDER =', e)
        console.log('-------------------------------------------------------------')
        return false;
    }
}

export async function saveWallet(orderId: number, pubKey: string, secKey: string, index: number): Promise<boolean> {
    try {
        await connectDB()
        const order = await Order.findOne({ id: orderId } as FilterQuery<IOrder>)
        const encryptedSk = await encrypt(secKey)
        if (!order) {
            throw new Error("Order not found")
        }
        else {
            const wallet = new Wallet({
                order: order._id,
                publicKey: pubKey,
                privateKey: encryptedSk,
            });
            const savedWallet = await wallet.save();
            await Order.findByIdAndUpdate(order._id, { $push: { wallet: savedWallet._id } });
            console.log("\u001b[1;32m" + 'SUCCESS ' + "\u001b[0m" + `Bot wallet #${index + 1} encrypted & saved to DB`)
            console.log('-------------------------------------------------------------')
        }
        return true
    } catch (e) {
        console.log("\u001b[1;31m" + 'ERROR ' + "\u001b[0m" + 'DB / SAVING WALLET =', e)
        return false
    }
}

export async function genWalletAndSaveDB(OrderID: number, WalletNbr: number): Promise<boolean> {
    try {
        const wallets = await genWallet(WalletNbr)
        const promises = wallets.map(async (wallet, index) => {
            console.log("\u001b[1;32m" + 'SUCCESS ' + "\u001b[0m" + `Generated keys for Bot #${index + 1}`)
            console.log("> PK |", wallet.publicKey)
            console.log("> SK |", wallet.secretKey)
            console.log('-------------------------------------------------------------')
            const ok = await saveWallet(OrderID, wallet.publicKey, wallet.secretKey, index)
            if (!ok) throw new Error(`Failed to save wallet for Bot${index + 1}`)
        })
        await Promise.all(promises)
        return true
    } catch (e) {
        console.log(e)
        return false
    }
}

export async function encrypt(sk: string) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.createHash('sha256').update(ENCRYPT_PASSWORD).digest('base64').substr(0, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(sk, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

export async function getTxStatus() {
    await connectDB()
    const stat = await Status.countDocuments()
    if (stat == 0) {
        const initStatus = new Status({ tx: 0 })
        const statusInitOk = await initStatus.save()
        if (statusInitOk) {
            console.log("\u001b[1;32m" + 'SUCCESS ' + "\u001b[0m" + `tx status initiated to 0`)
            console.log('-------------------------------------------------------------')
        }
        return 0;
    } else {
        const lastStatus = await Status.findOne({})
        console.log("\u001b[1;32m" + 'SUCCESS ' + "\u001b[0m" + `to get tx status ${lastStatus.tx}`)
        console.log('-------------------------------------------------------------')
        return lastStatus.tx
    }
}

export async function incrementTxStatus() {
    await connectDB()
    const ok = await Status.findOneAndUpdate({}, { $inc: { tx: 1 } }, { new: true })
    if (ok) {
        console.log("\u001b[1;32m" + 'SUCCESS ' + "\u001b[0m" + `tx status incremented to ${ok.tx}`)
        console.log('-------------------------------------------------------------')
        return ok.tx;
    } else {
        console.log("\u001b[1;31m" + 'ERROR ' + "\u001b[0m" + `could not update tx status`)
        console.log('-------------------------------------------------------------')
        return null;
    }
}

export async function setOrderCancelStatus(orderID: number) {
    await connectDB()
    const ordercanceled = await Order.findOneAndUpdate({ id: orderID }, { $set: { status: 'canceled' } }, { new: true })
    if (ordercanceled) {
        console.log("\u001b[1;32m" + 'SUCCESS ' + "\u001b[0m" + `order #${orderID} status updated to 'canceled'`)
        console.log('-------------------------------------------------------------')
    } else {
        console.log("\u001b[1;31m" + 'ERROR ' + "\u001b[0m" + `modifying order #${orderID} status`)
        console.log('-------------------------------------------------------------')
    }
}

export async function getWalletEncodedPrivateKeysForOrderId(orderID: number) {
    await connectDB()
    const order = await Order.findOne({ id: orderID })
    if (order) {
        let i
        let sk = []
        for (i = 0; order.wallet.length > i; i++) {
            const wallet = await Wallet.findById({ _id: order.wallet[i]._id })
            sk.push(wallet.privateKey)
        } return sk
    } else return null
}