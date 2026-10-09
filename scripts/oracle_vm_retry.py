#!/usr/bin/env python3
"""
Oracle Cloud A1.Flex Auto-Retry Script
Runs via GitHub Actions every 5 minutes until the VM is created.
Dynamically fetches Availability Domains and launches the VM.
"""

import oci
import os
import sys
import datetime

# ─── Config from GitHub Actions Secrets ──────────────────────────────────────
COMPARTMENT_ID  = os.environ["OCI_COMPARTMENT_ID"]
SUBNET_ID       = os.environ.get("OCI_SUBNET_ID")
IMAGE_ID        = os.environ.get("OCI_IMAGE_ID")
SSH_PUBLIC_KEY  = os.environ["OCI_SSH_PUBLIC_KEY"]
REGION          = os.environ.get("OCI_REGION", "ap-singapore-1")

# VM Configuration (2 OCPU, 12 GB RAM - Always Free eligible)
SHAPE           = "VM.Standard.A1.Flex"
OCPUS           = 2
MEMORY_GB       = 12
BOOT_VOLUME_GB  = 100
INSTANCE_NAME   = "teen-prod"

# ─── Timestamp helper ─────────────────────────────────────────────────────────
def ts():
    return datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

# ─── Main Logic ───────────────────────────────────────────────────────────────
def main():
    print(f"[{ts()}] 🚀 Oracle A1 Auto-Retry Script Starting")
    print(f"[{ts()}] Region: {REGION}")
    print(f"[{ts()}] Shape: {SHAPE} ({OCPUS} OCPUs, {MEMORY_GB} GB RAM)")
    print("─" * 60)

    # Initialize OCI clients
    try:
        config = oci.config.from_file("~/.oci/config")
        compute = oci.core.ComputeClient(config)
        identity = oci.identity.IdentityClient(config)
        network = oci.core.VirtualNetworkClient(config)
        print(f"[{ts()}] ✅ OCI clients initialized successfully")
    except Exception as e:
        print(f"[{ts()}] ❌ Failed to initialize OCI client: {e}")
        sys.exit(1)

    # 1. Fetch Availability Domains dynamically
    try:
        ad_response = identity.list_availability_domains(COMPARTMENT_ID)
        availability_domains = [ad.name for ad in ad_response.data]
        print(f"[{ts()}] 📍 Found {len(availability_domains)} Availability Domain(s): {', '.join(availability_domains)}")
    except Exception as e:
        print(f"[{ts()}] ⚠️ Could not list ADs dynamically ({e}), falling back to default")
        availability_domains = [f"VoYY:AP-SINGAPORE-1-AD-1"]

    # 2. Resolve Subnet ID if not explicitly provided
    global SUBNET_ID
    if not SUBNET_ID:
        try:
            subnets = network.list_subnets(COMPARTMENT_ID).data
            public_subnets = [s for s in subnets if not s.prohibit_public_ip_on_vnic]
            if public_subnets:
                SUBNET_ID = public_subnets[0].id
                print(f"[{ts()}] 🌐 Auto-detected public subnet: {public_subnets[0].display_name} ({SUBNET_ID})")
            elif subnets:
                SUBNET_ID = subnets[0].id
                print(f"[{ts()}] 🌐 Auto-detected subnet: {subnets[0].display_name} ({SUBNET_ID})")
        except Exception as e:
            print(f"[{ts()}] ⚠️ Could not auto-detect subnet: {e}")

    if not SUBNET_ID:
        print(f"[{ts()}] ❌ SUBNET_ID is required but could not be determined.")
        sys.exit(1)

    # 3. Resolve Image ID if not provided or set to 'auto'
    global IMAGE_ID
    if not IMAGE_ID or IMAGE_ID == "auto":
        try:
            images = compute.list_images(
                COMPARTMENT_ID,
                operating_system="Canonical Ubuntu",
                operating_system_version="22.04",
                shape=SHAPE
            ).data
            if images:
                IMAGE_ID = images[0].id
                print(f"[{ts()}] 💿 Auto-detected Ubuntu 22.04 ARM image: {images[0].display_name} ({IMAGE_ID})")
        except Exception as e:
            print(f"[{ts()}] ⚠️ Could not auto-detect image: {e}")
            IMAGE_ID = "ocid1.image.oc1.ap-singapore-1.aaaaaaaa4rgzowsv4u6hk6ugkk2be7ztbowlxwnonuvsxq4d73yjy4fc22ka"

    # 4. Try each Availability Domain
    for ad in availability_domains:
        print(f"\n[{ts()}] 🎯 Trying Availability Domain: {ad} ...")
        result = attempt_create(compute, ad)
        if result == "SUCCESS":
            print(f"\n[{ts()}] 🎉 ═══════════════════════════════════════════════")
            print(f"[{ts()}] 🎉  VM CREATED SUCCESSFULLY!")
            print(f"[{ts()}] 🎉  Check Oracle Console → Compute → Instances")
            print(f"[{ts()}] 🎉 ═══════════════════════════════════════════════")
            sys.exit(0)
        elif result == "CAPACITY_ERROR":
            print(f"[{ts()}] ⏳ {ad} — Out of capacity, trying next AD...")
        else:
            print(f"[{ts()}] ⚠️  {ad} — Result: {result}")

    print(f"\n[{ts()}] 💤 Out of host capacity right now. GitHub Actions will retry automatically on next cycle.")
    sys.exit(0)


def attempt_create(compute: oci.core.ComputeClient, availability_domain: str) -> str:
    """
    Attempts to create the A1 instance in the given AD.
    Returns: 'SUCCESS' | 'CAPACITY_ERROR' | error_message
    """
    try:
        launch_details = oci.core.models.LaunchInstanceDetails(
            availability_domain=availability_domain,
            compartment_id=COMPARTMENT_ID,
            display_name=INSTANCE_NAME,
            shape=SHAPE,
            shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
                ocpus=OCPUS,
                memory_in_gbs=MEMORY_GB
            ),
            source_details=oci.core.models.InstanceSourceViaImageDetails(
                source_type="image",
                image_id=IMAGE_ID,
                boot_volume_size_in_gbs=BOOT_VOLUME_GB
            ),
            create_vnic_details=oci.core.models.CreateVnicDetails(
                subnet_id=SUBNET_ID,
                assign_public_ip=True,
                display_name="teen-prod-vnic"
            ),
            metadata={
                "ssh_authorized_keys": SSH_PUBLIC_KEY
            }
        )

        response = compute.launch_instance(launch_details)
        instance = response.data

        print(f"[{ts()}] ✅ Instance ID: {instance.id}")
        print(f"[{ts()}] ✅ State: {instance.lifecycle_state}")
        return "SUCCESS"

    except oci.exceptions.ServiceError as e:
        # Check for Out of host capacity / InternalError / RateLimit
        if "Out of capacity" in str(e.message) or "InternalError" in str(e.code) or e.status in [500, 429]:
            return "CAPACITY_ERROR"
        return f"HTTP {e.status} {e.code}: {e.message}"

    except Exception as e:
        return f"Unexpected error: {str(e)}"


if __name__ == "__main__":
    main()
