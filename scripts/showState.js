const { ethers } = require("hardhat");

async function main() {
  const [regulator, canadaBank, usBank, alice] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("CrossBorderCreditRegistry");
  const registry = await Registry.connect(regulator).deploy();
  await registry.waitForDeployment();

  await (await registry.authorizeInstitution(canadaBank.address, "Maple Bank", "Canada")).wait();
  await (await registry.authorizeInstitution(usBank.address, "Steel City Credit Union", "United States")).wait();
  await (await registry.connect(alice).registerBorrower(ethers.id("did:portable-credit:alice:demo"), "Canada")).wait();

  await (await registry.connect(canadaBank).submitCreditRecord(alice.address, "loan_repayment", 45, "ipfs://loan-repayment-q1")).wait();
  await (await registry.connect(usBank).submitCreditRecord(alice.address, "credit_card_on_time_payment", 15, "ipfs://us-card-payment-april")).wait();

  const ids = await registry.getBorrowerRecordIds(alice.address);
  console.log(`Alice has ${ids.length} credit records across Canada and the United States.`);

  for (const id of ids) {
    const record = await registry.getCreditRecord(id);
    console.log(
      `Record ${record.id}: ${record.jurisdiction}, ${record.recordType}, score delta ${record.scoreDelta}, metadata ${record.metadataHash}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

