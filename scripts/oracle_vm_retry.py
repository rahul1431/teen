#!/usr/bin/env python3
"""
Oracle Cloud A1.Flex Auto-Retry Script
Runs via GitHub Actions every 5 minutes until the VM is created.
Tries all 3 Availability Domains in ap-singapore-1.
"""

import oci
import os
import sys
import json
import datetime

# ─── Config from GitHub Actions Secrets ──────────────────────────────────────
COMPARTMENT_ID  = os.environ["OCI_COMPARTMENT_ID"]
SUBNET_ID       = os.environ["OCI_SUBNET_ID"]
IMAGE_ID        = os.environ["OCI_IMAGE_ID"]
SSH_PUBLIC_KEY  = os.environ["OCI_SSH_PUBLIC_KEY"]
REGION          = os.environ.get("OCI_REGION", "ap-singapore-1")

# Singapore has 3 Availability Domains — try all 3 on each run
AVAILABILITY_DOMAINS = [
    f"qprs:AP-SINGAPORE-1-AD-1",
    f"qprs:AP-SINGAPORE-1-AD-2",
    f"qprs:AP-SINGAPORE-1-AD-3",
]

# VM Configuration
SHAPE           = "VM.Standard.A1.Flex"
OCPUS           = 4
MEMORY_GB       = 24
BOOT_VOLUME_GB  = 200
INSTANCE_NAME   = "teen-prod"
OS              = "Ubuntu 22.04"  # informational only

# ─── Timestamp helper ─────────────────────────────────────────────────────────
def ts():
    return datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

# ─── Main Logic ───────────────────────────────────────────────────────────────
def main():
    print(f"[{ts()}] Oracle A1 Auto-Retry Script Starting")
    print(f"[{ts()}] Region: {REGION}")
    print(f"[{ts()}] Shape: {SHAPE} ({OCPUS} OCPUs, {MEMORY_GB} GB RAM)")
    print(f"[{ts()}] Trying {len(AVAILABILITY_DOMAINS)} Availability Domains...")
    print("─" * 60)

    # Initialize OCI compute client (uses ~/.oci/config written by workflow)
    try:
        config = oci.config.from_file("~/.oci/config")
        compute = oci.core.ComputeClient(config)
        print(f"[{ts()}] ✅ OCI client initialized successfully")
    except Exception as e:
        print(f"[{ts()}] ❌ Failed to initialize OCI client: {e}")
        sys.exit(1)

    # Try each Availability Domain
    for ad in AVAILABILITY_DOMAINS:
        print(f"\n[{ts()}] Trying: {ad}")
        result = attempt_create(compute, ad)
        if result == "SUCCESS":
            print(f"\n[{ts()}] 🎉 ══════════════════════════════════")
            print(f"[{ts()}] 🎉  VM CREATED SUCCESSFULLY!")
            print(f"[{ts()}] 🎉  Check Oracle Console → Compute → Instances")
            print(f"[{ts()}] 🎉 ══════════════════════════════════")
            # Exit with code 0 — GitHub Actions will mark as success
            # You'll see this in the Actions tab as a green ✅
            sys.exit(0)
        elif result == "CAPACITY_ERROR":
            print(f"[{ts()}] ⏳ {ad} — Out of capacity, trying next AD...")
        else:
            print(f"[{ts()}] ⚠️  {ad} — Error: {result}")

    # All ADs failed — this run failed, next scheduled run will try again
    print(f"\n[{ts()}] All {len(AVAILABILITY_DOMAINS)} ADs at capacity. Will retry in 5 minutes.")
    print(f"[{ts()}] ℹ️  This is normal — keep watching GitHub Actions tab.")
    # Exit 0 so GitHub doesn't spam "workflow failed" emails
    sys.exit(0)


def attempt_create(compute: oci.core.ComputeClient, availability_domain: str) -> str:
    """
    Attempts to create the A1 instance in the given AD.
    Returns: 'SUCCESS' | 'CAPACITY_ERROR' | error_message
    """
    try:
        launch_details = oci.core.models.LaunchInstanceDetails(
            # ── Location ──────────────────────────────────────────────────
            availability_domain=availability_domain,
            compartment_id=COMPARTMENT_ID,

            # ── Name ──────────────────────────────────────────────────────
            display_name=INSTANCE_NAME,

            # ── Shape (ARM A1) ────────────────────────────────────────────
            shape=SHAPE,
            shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
                ocpus=OCPUS,
                memory_in_gbs=MEMORY_GB
            ),

            # ── OS Image ──────────────────────────────────────────────────
            source_details=oci.core.models.InstanceSourceViaImageDetails(
                source_type="image",
                image_id=IMAGE_ID,
                boot_volume_size_in_gbs=BOOT_VOLUME_GB
            ),

            # ── Network ───────────────────────────────────────────────────
            create_vnic_details=oci.core.models.CreateVnicDetails(
                subnet_id=SUBNET_ID,
                assign_public_ip=True,
                display_name="teen-prod-vnic"
            ),

            # ── SSH Key ───────────────────────────────────────────────────
            metadata={
                "ssh_authorized_keys": SSH_PUBLIC_KEY
            },

            # ── NO fault_domain specified — this is intentional! ──────────
            # Specifying a fault domain reduces availability further.
        )

        response = compute.launch_instance(launch_details)
        instance = response.data

        print(f"[{ts()}] ✅ Instance ID: {instance.id}")
        print(f"[{ts()}] ✅ State: {instance.lifecycle_state}")
        return "SUCCESS"

    except oci.exceptions.ServiceError as e:
        # "Out of capacity" errors have specific codes
        if e.status == 500 and ("Out of capacity" in str(e.message) or "InternalError" in str(e.code)):
            return "CAPACITY_ERROR"
        if e.status == 429:
            return "CAPACITY_ERROR"  # Rate limited — treat same as capacity
        # Real errors (config wrong, auth failed, etc.)
        return f"HTTP {e.status} {e.code}: {e.message}"

    except Exception as e:
        return f"Unexpected error: {str(e)}"


if __name__ == "__main__":
    main()
