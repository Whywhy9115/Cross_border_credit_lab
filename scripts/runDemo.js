const { ethers } = require("hardhat");

async function printRecord(registry, id, label) {
  const record = await registry.getCreditRecord(id);
  console.log(`\n${label}`);
  console.log(`  record id: ${record.id}`);
  console.log(`  borrower: ${record.borrower}`);
  console.log(`  institution: ${record.institution}`);
  console.log(`  jurisdiction: ${record.jurisdiction}`);
  console.log(`  type: ${record.recordType}`);
  console.log(`  score delta: ${record.scoreDelta}`);
  console.log(`  metadata hash: ${record.metadataHash}`);
  console.log(`  previous record id: ${record.previousRecordId}`);
  console.log(`  disputed: ${record.disputed}`);
}

async function main() {
  const [regulator, canadaBank, usBank, alice, attacker] = await ethers.getSigners();

  const Registry = await ethers.getContractFactory("CrossBorderCreditRegistry");
  const registry = await Registry.connect(regulator).deploy();
  await registry.waitForDeployment();

  console.log("Cross-border credit registry deployed");
  console.log(`  contract: ${await registry.getAddress()}`);
  console.log(`  regulator owner: ${regulator.address}`);
  console.log(`  Canada bank: ${canadaBank.address}`);
  console.log(`  US bank: ${usBank.address}`);
  console.log(`  Alice borrower: ${alice.address}`);

  console.log("\nStep 1: regulator authorizes institutions in two jurisdictions");
  await (await registry.authorizeInstitution(canadaBank.address, "Maple Bank", "Canada")).wait();
  await (await registry.authorizeInstitution(usBank.address, "Steel City Credit Union", "United States")).wait();

  console.log("\nStep 2: Alice registers one portable blockchain identity");
  const aliceIdentityHash = ethers.id("did:portable-credit:alice:demo");
  await (await registry.connect(alice).registerBorrower(aliceIdentityHash, "Canada")).wait();
  console.log(`  identity hash: ${aliceIdentityHash}`);

  console.log("\nStep 3: Canada bank submits an append-only credit record");
  const tx1 = await registry
    .connect(canadaBank)
    .submitCreditRecord(alice.address, "loan_repayment", 45, "ipfs://loan-repayment-q1");
  const receipt1 = await tx1.wait();
  const recordId1 = receipt1.logs
    .map((log) => registry.interface.parseLog(log))
    .find((event) => event.name === "CreditRecordSubmitted").args.recordId;
  await printRecord(registry, recordId1, "Original Canadian record");

  console.log("\nStep 4: Alice disputes the Canadian record");
  await (await registry.connect(alice).openDispute(recordId1, "ipfs://alice-dispute-wrong-delta")).wait();
  const disputedRecord = await registry.getCreditRecord(recordId1);
  console.log(`  disputed flag after Alice opens dispute: ${disputedRecord.disputed}`);

  console.log("\nStep 5: source institution resolves dispute by appending a correction");
  const tx2 = await registry
    .connect(canadaBank)
    .resolveDispute(
      recordId1,
      true,
      "ipfs://maple-bank-investigation",
      "loan_repayment_corrected",
      60,
      "ipfs://loan-repayment-q1-corrected"
    );
  const receipt2 = await tx2.wait();
  const correctionId = receipt2.logs
    .map((log) => registry.interface.parseLog(log))
    .find((event) => event.name === "DisputeResolved").args.correctionRecordId;
  await printRecord(registry, correctionId, "Correction record appended after dispute");

  console.log("\nStep 6: a US institution can add a new record for the same Alice identity");
  const tx3 = await registry
    .connect(usBank)
    .submitCreditRecord(alice.address, "credit_card_on_time_payment", 15, "ipfs://us-card-payment-april");
  const receipt3 = await tx3.wait();
  const usRecordId = receipt3.logs
    .map((log) => registry.interface.parseLog(log))
    .find((event) => event.name === "CreditRecordSubmitted").args.recordId;
  await printRecord(registry, usRecordId, "United States record");

  console.log("\nStep 7: unauthorized accounts cannot write credit records");
  try {
    await registry
      .connect(attacker)
      .submitCreditRecord(alice.address, "fake_record", -100, "ipfs://fake");
  } catch (error) {
    console.log(`  blocked with error: ${error.message.split("\n")[0]}`);
  }

  const recordIds = await registry.getBorrowerRecordIds(alice.address);
  console.log("\nFinal borrower record history for Alice");
  console.log(`  record ids: ${recordIds.map((id) => id.toString()).join(", ")}`);
  console.log("  original records stay on-chain; corrections are new records that reference old records.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

