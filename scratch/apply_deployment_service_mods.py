import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    filepath = "services/admin-service/src/services/deployment.service.ts"
    print(f"Reading {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        code = f.read()

    # 1. Add getProjectPath helper
    helper_method = """  private getProjectPath(environment?: 'dev' | 'prod'): string {
    if (environment) {
      return environment === 'dev' ? '/opt/teen-dev' : '/opt/teen-prod';
    }
    return process.cwd().includes('teen-dev') ? '/opt/teen-dev' : '/opt/teen-prod';
  }

  /**
   * Get environment configuration"""
   
    code = code.replace("  /**\n   * Get environment configuration", helper_method)

    # 2. Update runSafetyChecks to pass environment to all checks
    old_safety_promises = """    const allCheckPromises = [
      this.checkGitClean(branch),
      this.checkValidBranch(branch),
      this.checkTestsPassed(),
      this.checkDatabaseConnectivity(environment),
      this.checkRedisConnectivity(environment),
      this.checkServicesHealth(environment),
      this.checkDiskSpace(environment),
      this.checkDatabaseBackups(environment),
      this.checkBranchUpdated(branch),
      this.checkDatabaseMigrations(environment),
      this.checkPreviousDeploymentStatus(environment),
    ]"""

    new_safety_promises = """    const allCheckPromises = [
      this.checkGitClean(branch, environment),
      this.checkValidBranch(branch),
      this.checkTestsPassed(environment),
      this.checkDatabaseConnectivity(environment),
      this.checkRedisConnectivity(environment),
      this.checkServicesHealth(environment),
      this.checkDiskSpace(environment),
      this.checkDatabaseBackups(environment),
      this.checkBranchUpdated(branch, environment),
      this.checkDatabaseMigrations(environment),
      this.checkPreviousDeploymentStatus(environment),
    ]"""

    code = code.replace(old_safety_promises, new_safety_promises)

    # 3. Update checkGitClean signature & implementation
    old_git_clean = """  private async checkGitClean(branch: string): Promise<SafetyCheckResult | null> {
    try {
      const gitStatus = await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && git status --porcelain`,
        10000
      )"""

    new_git_clean = """  private async checkGitClean(branch: string, environment?: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const projectPath = this.getProjectPath(environment)
      const gitStatus = await this.runSSHCommand(
        `cd ${projectPath} && git status --porcelain`,
        10000
      )"""

    code = code.replace(old_git_clean, new_git_clean)

    # 4. Update checkTestsPassed signature & implementation
    old_tests_passed = """  private async checkTestsPassed(): Promise<SafetyCheckResult | null> {
    try {
      await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && npm test -- --passWithNoTests --maxWorkers=2 2>&1`,
        2 * 60 * 1000 // 2 minute timeout
      )"""

    new_tests_passed = """  private async checkTestsPassed(environment?: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const projectPath = this.getProjectPath(environment)
      await this.runSSHCommand(
        `cd ${projectPath} && npm test -- --passWithNoTests --maxWorkers=2 2>&1`,
        2 * 60 * 1000 // 2 minute timeout
      )"""

    code = code.replace(old_tests_passed, new_tests_passed)

    # 5. Update checkDiskSpace implementation
    old_disk_space = """      const diskOutput = await this.runSSHCommand(
        `df /opt/teen | tail -1 | awk '{print $4}'`,
        10000
      )"""

    new_disk_space = """      const projectPath = this.getProjectPath(environment)
      const diskOutput = await this.runSSHCommand(
        `df ${projectPath} | tail -1 | awk '{print $4}'`,
        10000
      )"""

    code = code.replace(old_disk_space, new_disk_space)

    # 6. Update checkBranchUpdated signature & implementation
    old_branch_updated = """  private async checkBranchUpdated(branch: string): Promise<SafetyCheckResult | null> {
    try {
      const behindMain = await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && git rev-list --left-only --count main...${branch} 2>/dev/null || echo 0`,
        10000
      )"""

    new_branch_updated = """  private async checkBranchUpdated(branch: string, environment?: 'dev' | 'prod'): Promise<SafetyCheckResult | null> {
    try {
      const projectPath = this.getProjectPath(environment)
      const behindMain = await this.runSSHCommand(
        `cd ${projectPath} && git rev-list --left-only --count main...${branch} 2>/dev/null || echo 0`,
        10000
      )"""

    code = code.replace(old_branch_updated, new_branch_updated)

    # 7. Update runDeploymentAsync to resolve paths & PM2 commands
    old_run_deploy = """      // Get the previous commit hash for rollback
      previousCommit = await this.getPreviousCommit()
      await this.logDeployment(jobId, `${envConfig.tag} Previous commit saved: ${previousCommit}`, 'info')

      // Step 1: Git pull
      await this.logDeployment(jobId, `${envConfig.tag} Running: git pull origin ${branch}`, 'info')
      const gitOutput = await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && git pull origin ${branch}`
      )
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Git pull completed: ${gitOutput.substring(0, 200)}...`,
        'info'
      )

      // Step 2: Verify commit hash
      const currentCommit = await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && git rev-parse HEAD`
      )
      if (!currentCommit.includes(commitHash)) {
        throw new Error(`Commit mismatch: expected ${commitHash}, got ${currentCommit}`)
      }
      await this.logDeployment(jobId, `${envConfig.tag} Verified commit hash: ${commitHash}`, 'info')

      // Step 3-5: npm install for root and services
      const services = ['', 'services/game-gateway', 'services/admin-service']
      for (const svc of services) {
        const svcPath = svc ? `${this.vpsConfig.projectPath}/${svc}` : this.vpsConfig.projectPath
        const svcName = svc || 'root'
        await this.logDeployment(
          jobId,
          `${envConfig.tag} Installing dependencies for ${svcName}...`,
          'info'
        )
        const output = await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
        await this.logDeployment(
          jobId,
          `${envConfig.tag} npm install completed for ${svcName}`,
          'info'
        )
      }

      // Step 6: Kill and restart PM2 with environment-specific config
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Restarting services with PM2 (${envConfig.ecosystemConfig})...`,
        'info'
      )
      await this.runSSHCommand(`pm2 kill`)
      const pm2Output = await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
      )"""

    new_run_deploy = """      const projectPath = this.getProjectPath(environment)
      // Get the previous commit hash for rollback
      previousCommit = await this.getPreviousCommit(environment)
      await this.logDeployment(jobId, `${envConfig.tag} Previous commit saved: ${previousCommit}`, 'info')

      // Step 1: Git pull
      await this.logDeployment(jobId, `${envConfig.tag} Running: git pull origin ${branch}`, 'info')
      const gitOutput = await this.runSSHCommand(
        `cd ${projectPath} && git pull origin ${branch}`
      )
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Git pull completed: ${gitOutput.substring(0, 200)}...`,
        'info'
      )

      // Step 2: Verify commit hash
      const currentCommit = await this.runSSHCommand(
        `cd ${projectPath} && git rev-parse HEAD`
      )
      if (!currentCommit.includes(commitHash)) {
        throw new Error(`Commit mismatch: expected ${commitHash}, got ${currentCommit}`)
      }
      await this.logDeployment(jobId, `${envConfig.tag} Verified commit hash: ${commitHash}`, 'info')

      // Step 3-5: npm install for root and services
      const services = ['', 'services/game-gateway', 'services/admin-service']
      for (const svc of services) {
        const svcPath = svc ? `${projectPath}/${svc}` : projectPath
        const svcName = svc || 'root'
        await this.logDeployment(
          jobId,
          `${envConfig.tag} Installing dependencies for ${svcName}...`,
          'info'
        )
        const output = await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
        await this.logDeployment(
          jobId,
          `${envConfig.tag} npm install completed for ${svcName}`,
          'info'
        )
      }

      // Step 6: Restart PM2 with environment-specific config
      await this.logDeployment(
        jobId,
        `${envConfig.tag} Restarting services with PM2 (${envConfig.ecosystemConfig})...`,
        'info'
      )
      await this.runSSHCommand(`pm2 delete ${envConfig.ecosystemConfig} || true`)
      const pm2Output = await this.runSSHCommand(
        `cd ${projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
      )"""

    code = code.replace(old_run_deploy, new_run_deploy)

    # 8. Update getPreviousCommit signature & implementation
    old_prev_commit = """  private async getPreviousCommit(): Promise<string> {
    const commit = await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && git rev-parse HEAD`
    )
    return commit.trim()
  }"""

    new_prev_commit = """  private async getPreviousCommit(environment?: 'dev' | 'prod'): Promise<string> {
    const projectPath = this.getProjectPath(environment)
    const commit = await this.runSSHCommand(
      `cd ${projectPath} && git rev-parse HEAD`
    )
    return commit.trim()
  }"""

    code = code.replace(old_prev_commit, new_prev_commit)

    # 9. Update autoRollback implementation
    old_auto_rollback = """    // Git reset to previous commit
    await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && git reset --hard ${previousCommit}`
    )
    await this.logDeployment(jobId, `${envConfig.tag} Git reset completed`, 'info')

    # npm install for previous commit dependencies
    const services = ['', 'services/game-gateway', 'services/admin-service']
    for (const svc of services) {
      const svcPath = svc ? `${this.vpsConfig.projectPath}/${svc}` : this.vpsConfig.projectPath
      const svcName = svc || 'root'
      await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
    }
    await this.logDeployment(jobId, `${envConfig.tag} Dependencies reinstalled`, 'info')

    // Restart services with environment-specific config
    await this.runSSHCommand('pm2 kill')
    await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
    )"""

    new_auto_rollback = """    const projectPath = this.getProjectPath(environment)
    // Git reset to previous commit
    await this.runSSHCommand(
      `cd ${projectPath} && git reset --hard ${previousCommit}`
    )
    await this.logDeployment(jobId, `${envConfig.tag} Git reset completed`, 'info')

    // npm install for previous commit dependencies
    const services = ['', 'services/game-gateway', 'services/admin-service']
    for (const svc of services) {
      const svcPath = svc ? `${projectPath}/${svc}` : projectPath
      const svcName = svc || 'root'
      await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
    }
    await this.logDeployment(jobId, `${envConfig.tag} Dependencies reinstalled`, 'info')

    // Restart services with environment-specific config
    await this.runSSHCommand(`pm2 delete ${envConfig.ecosystemConfig} || true`)
    await this.runSSHCommand(
      `cd ${projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
    )"""

    code = code.replace(old_auto_rollback, new_auto_rollback)

    # 10. Update rollbackDeployment implementation
    old_manual_rollback = """      // Get the current commit hash to use for the rollback reference
      const currentCommitResult = await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && git rev-parse HEAD`
      )
      currentCommitHash = currentCommitResult.trim()

      // Step 2: Checkout previous commit
      await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && git checkout ${previousCommitHash}`
      )

      await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && git reset --hard ${previousCommitHash}`
      )

      // Step 3: Reinstall dependencies
      const services = ['', 'services/game-gateway', 'services/admin-service']
      for (const svc of services) {
        const svcPath = svc ? `${this.vpsConfig.projectPath}/${svc}` : this.vpsConfig.projectPath
        await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
      }

      // Step 4: Restart services
      await this.runSSHCommand(`pm2 kill`)
      await this.runSSHCommand(
        `cd ${this.vpsConfig.projectPath} && pm2 start ecosystem.config.js && pm2 save`
      )

      // Step 5: Wait for services to start
      await this.sleep(5000)

      // Step 6: Health check
      const healthResults = await this.checkServiceHealth()
      const allHealthy = healthResults.every((r) => r.healthy)

      if (!allHealthy) {
        // Auto-rollback the rollback if services fail
        await this.runSSHCommand(
          `cd ${this.vpsConfig.projectPath} && git reset --hard ${currentCommitHash}`
        )
        await this.runSSHCommand(`pm2 kill`)
        await this.runSSHCommand(
          `cd ${this.vpsConfig.projectPath} && pm2 start ecosystem.config.js && pm2 save`
        )"""

    new_manual_rollback = """      const projectPath = this.getProjectPath('prod')
      // Get the current commit hash to use for the rollback reference
      const currentCommitResult = await this.runSSHCommand(
        `cd ${projectPath} && git rev-parse HEAD`
      )
      currentCommitHash = currentCommitResult.trim()

      // Step 2: Checkout previous commit
      await this.runSSHCommand(
        `cd ${projectPath} && git checkout ${previousCommitHash}`
      )

      await this.runSSHCommand(
        `cd ${projectPath} && git reset --hard ${previousCommitHash}`
      )

      // Step 3: Reinstall dependencies
      const services = ['', 'services/game-gateway', 'services/admin-service']
      for (const svc of services) {
        const svcPath = svc ? `${projectPath}/${svc}` : projectPath
        await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
      }

      // Step 4: Restart services
      await this.runSSHCommand(`pm2 delete ecosystem.config.js || true`)
      await this.runSSHCommand(
        `cd ${projectPath} && pm2 start ecosystem.config.js && pm2 save`
      )

      // Step 5: Wait for services to start
      await this.sleep(5000)

      // Step 6: Health check
      const healthResults = await this.checkServiceHealth()
      const allHealthy = healthResults.every((r) => r.healthy)

      if (!allHealthy) {
        // Auto-rollback the rollback if services fail
        await this.runSSHCommand(
          `cd ${projectPath} && git reset --hard ${currentCommitHash}`
        )
        await this.runSSHCommand(`pm2 delete ecosystem.config.js || true`)
        await this.runSSHCommand(
          `cd ${projectPath} && pm2 start ecosystem.config.js && pm2 save`
        )"""

    code = code.replace(old_manual_rollback, new_manual_rollback)

    # 11. Update rollbackDeploymentWithEnvironment implementation
    old_enhanced_rollback_state = """      // STEP 2: Get deployment info and backup current state
      await this.updateRollbackStep(rollbackId, 2, 'Backup Current State', 'in_progress')
      const prevDeployment = await this.getDeploymentInfo(previousDeploymentId)
      const currentCommit = await this.runSSHCommand(`cd ${this.vpsConfig.projectPath} && git rev-parse HEAD`)"""

    new_enhanced_rollback_state = """      // STEP 2: Get deployment info and backup current state
      await this.updateRollbackStep(rollbackId, 2, 'Backup Current State', 'in_progress')
      const prevDeployment = await this.getDeploymentInfo(previousDeploymentId)
      const projectPath = this.getProjectPath(environment)
      const currentCommit = await this.runSSHCommand(`cd ${projectPath} && git rev-parse HEAD`)"""

    code = code.replace(old_enhanced_rollback_state, new_enhanced_rollback_state)

    # 12. Update stopServicesGracefully implementation
    old_stop_services = """    try {
      await this.runSSHCommand(`pm2 stop all`, timeoutMs)
      await this.sleep(2000)
    } catch (err) {
      await this.logDeploymentRollback('temp', `${envConfig.tag} Warning: graceful stop timed out, forcing kill`, 'warn')
      try {
        await this.runSSHCommand(`pm2 kill`, 10000)
      } catch (killErr) {
        await this.logDeploymentRollback('temp', `${envConfig.tag} Warning: could not kill PM2`, 'warn')
      }
    }"""

    new_stop_services = """    try {
      await this.runSSHCommand(`pm2 stop ${envConfig.ecosystemConfig}`, timeoutMs)
      await this.sleep(2000)
    } catch (err) {
      await this.logDeploymentRollback('temp', `${envConfig.tag} Warning: graceful stop timed out, forcing delete`, 'warn')
      try {
        await this.runSSHCommand(`pm2 delete ${envConfig.ecosystemConfig}`, 10000)
      } catch (killErr) {
        await this.logDeploymentRollback('temp', `${envConfig.tag} Warning: could not delete PM2 processes`, 'warn')
      }
    }"""

    code = code.replace(old_stop_services, new_stop_services)

    # 13. Update restorePreviousCode, restoreDependencies, startServicesForEnvironment implementations
    old_restore_code = """  private async restorePreviousCode(environment: 'dev' | 'prod', commitHash: string, rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)

    await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && git fetch origin && git checkout ${commitHash}`
    )

    await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && git reset --hard ${commitHash}`
    )"""

    new_restore_code = """  private async restorePreviousCode(environment: 'dev' | 'prod', commitHash: string, rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const projectPath = this.getProjectPath(environment)

    await this.runSSHCommand(
      `cd ${projectPath} && git fetch origin && git checkout ${commitHash}`
    )

    await this.runSSHCommand(
      `cd ${projectPath} && git reset --hard ${commitHash}`
    )"""

    code = code.replace(old_restore_code, new_restore_code)

    old_restore_dep = """  private async restoreDependencies(environment: 'dev' | 'prod', rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const services = ['', 'services/game-gateway', 'services/admin-service']

    for (const svc of services) {
      const svcPath = svc ? `${this.vpsConfig.projectPath}/${svc}` : this.vpsConfig.projectPath
      const svcName = svc || 'root'

      await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
    }"""

    new_restore_dep = """  private async restoreDependencies(environment: 'dev' | 'prod', rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const projectPath = this.getProjectPath(environment)
    const services = ['', 'services/game-gateway', 'services/admin-service']

    for (const svc of services) {
      const svcPath = svc ? `${projectPath}/${svc}` : projectPath
      const svcName = svc || 'root'

      await this.runSSHCommand(`cd ${svcPath} && npm install --production=false 2>&1`)
    }"""

    code = code.replace(old_restore_dep, new_restore_dep)

    old_start_services = """  private async startServicesForEnvironment(environment: 'dev' | 'prod', rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)

    await this.runSSHCommand(`pm2 kill`)
    await this.runSSHCommand(
      `cd ${this.vpsConfig.projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
    )"""

    new_start_services = """  private async startServicesForEnvironment(environment: 'dev' | 'prod', rollbackId?: string): Promise<void> {
    const envConfig = this.getEnvConfig(environment)
    const projectPath = this.getProjectPath(environment)

    await this.runSSHCommand(`pm2 delete ${envConfig.ecosystemConfig} || true`)
    await this.runSSHCommand(
      `cd ${projectPath} && pm2 start ${envConfig.ecosystemConfig} && pm2 save`
    )"""

    code = code.replace(old_start_services, new_start_services)

    # 14. Update runRollbackSafetyChecks disk check
    old_rollback_disk = """    // Check 3: Disk space available
    try {
      const diskOutput = await this.runSSHCommand(`df ${this.vpsConfig.projectPath} | tail -1 | awk '{print $4}'`)"""

    new_rollback_disk = """    // Check 3: Disk space available
    try {
      const projectPath = this.getProjectPath(environment)
      const diskOutput = await this.runSSHCommand(`df ${projectPath} | tail -1 | awk '{print $4}'`)"""

    code = code.replace(old_rollback_disk, new_rollback_disk)

    # 15. Fix python comment character for JS files
    code = code.replace("# npm install for previous commit dependencies", "// npm install for previous commit dependencies")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(code)
    print("Updated local deployment.service.ts successfully.")

    # 16. Upload updated file to VPS for both dev and prod
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        sftp = client.open_sftp()
        sftp.put(filepath, "/opt/teen-dev/services/admin-service/src/services/deployment.service.ts")
        sftp.put(filepath, "/opt/teen-prod/services/admin-service/src/services/deployment.service.ts")
        sftp.close()
        print("Uploaded modified deployment.service.ts to both dev and prod on VPS.")
    except Exception as e:
        print(f"SSH upload failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
