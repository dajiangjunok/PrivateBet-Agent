-- CreateEnum
CREATE TYPE "WalletPurpose" AS ENUM ('deposit', 'privacy_pool', 'betting');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('received', 'privatizing', 'privatized');

-- CreateEnum
CREATE TYPE "BetSide" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('pending', 'active', 'settled');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('YES', 'NO', 'SKIP');

-- CreateEnum
CREATE TYPE "PrivacyOpType" AS ENUM ('deposit_to_zama', 'withdraw_from_zama');

-- CreateEnum
CREATE TYPE "PrivacyOpStatus" AS ENUM ('pending', 'encrypting', 'submitted', 'awaiting_decrypt', 'complete', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "tg_user_id" BIGINT NOT NULL,
    "polygon_deposit_address" TEXT,
    "zama_address" TEXT,
    "mpc_user_id" TEXT,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("tg_user_id")
);

-- CreateTable
CREATE TABLE "wallets_subaccounts" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "purpose" "WalletPurpose" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_subaccounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'received',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bets" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "market_id" TEXT NOT NULL,
    "side" "BetSide" NOT NULL,
    "amount" DECIMAL NOT NULL,
    "entry_price" DECIMAL NOT NULL,
    "status" "BetStatus" NOT NULL DEFAULT 'pending',
    "polymarket_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" SERIAL NOT NULL,
    "market_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "recommendation" "RecommendationType" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,
    "llm_model_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_operations" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "type" "PrivacyOpType" NOT NULL,
    "source_addr" TEXT NOT NULL,
    "dest_addr" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "tx_hashes" JSONB NOT NULL,
    "status" "PrivacyOpStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_operations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "wallets_subaccounts" ADD CONSTRAINT "wallets_subaccounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("tg_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("tg_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bets" ADD CONSTRAINT "bets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("tg_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_operations" ADD CONSTRAINT "privacy_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("tg_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
