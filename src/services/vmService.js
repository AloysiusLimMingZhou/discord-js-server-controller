const compute = require('@google-cloud/compute');
const config = require('../config');

const instancesClient = new compute.InstancesClient();

/**
 * Start the VM instance.
 * @returns {Promise<string>} Operation status message.
 */
async function startVM() {
  const [response] = await instancesClient.start({
    project: config.gcp.projectId,
    zone: config.gcp.zone,
    instance: config.gcp.instanceName,
  });

  // Wait for the operation to complete
  const operationsClient = new compute.ZoneOperationsClient();
  let operation = response.latestResponse;

  while (operation.status !== 'DONE') {
    [operation] = await operationsClient.wait({
      project: config.gcp.projectId,
      zone: config.gcp.zone,
      operation: operation.name,
    });
  }

  // Check for errors in the completed operation
  if (operation.error) {
    const errorMsg = operation.error.errors
      .map((e) => `${e.code}: ${e.message}`)
      .join('\n');
    throw new Error(errorMsg);
  }

  return 'VM instance started successfully.';
}

/**
 * Stop the VM instance.
 * @returns {Promise<string>} Operation status message.
 */
async function stopVM() {
  const [response] = await instancesClient.stop({
    project: config.gcp.projectId,
    zone: config.gcp.zone,
    instance: config.gcp.instanceName,
  });

  const operationsClient = new compute.ZoneOperationsClient();
  let operation = response.latestResponse;

  while (operation.status !== 'DONE') {
    [operation] = await operationsClient.wait({
      project: config.gcp.projectId,
      zone: config.gcp.zone,
      operation: operation.name,
    });
  }

  // Check for errors in the completed operation
  if (operation.error) {
    const errorMsg = operation.error.errors
      .map((e) => `${e.code}: ${e.message}`)
      .join('\n');
    throw new Error(errorMsg);
  }

  return 'VM instance stopped successfully.';
}

/**
 * Get the current status of the VM instance.
 * @returns {Promise<object>} Instance details.
 */
async function getVMStatus() {
  const [instance] = await instancesClient.get({
    project: config.gcp.projectId,
    zone: config.gcp.zone,
    instance: config.gcp.instanceName,
  });

  const externalIp =
    instance.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP ?? 'N/A';

  return {
    name: instance.name,
    status: instance.status,           // RUNNING, STOPPED, STAGING, etc.
    machineType: instance.machineType?.split('/').pop() ?? 'unknown',
    zone: config.gcp.zone,
    externalIp,
    creationTimestamp: instance.creationTimestamp,
    lastStartTimestamp: instance.lastStartTimestamp,
  };
}

module.exports = { startVM, stopVM, getVMStatus };
