const {RelayProvider} = require("@opengsn/gsn")
const GsnTestEnvironment = require('@opengsn/gsn/dist/GsnTestEnvironment').default
const {expectRevert} = require('@openzeppelin/test-helpers')
// import {SampleRecipientInstance} from "../types/truffle-contracts";

const WhitelistPaymaster = artifacts.require('WhitelistPaymaster')
const SampleRecipient = artifacts.require('SampleRecipient')

const relayHubAddress = require('../build/gsn/RelayHub').address
const forwarderAddress = require('../build/gsn/Forwarder').address
const stakeManagerAddress = require('../build/gsn/StakeManager').address

contract('WhitelistPaymaster', ([from, another]) => {

    let pm
    let s //: SampleRecipientInstance
    let s1 //: SampleRecipientInstance
    let gsnConfig
    before(async () => {
        const {
            deploymentResult: {
                relayHubAddress,
                stakeManagerAddress,
                forwarderAddress
            }
        } = await GsnTestEnvironment.startGsn('localhost')

        s = await SampleRecipient.new()
        s1 = await SampleRecipient.new()
        await s.setForwarder(forwarderAddress)
        await s1.setForwarder(forwarderAddress)

        // @ts-ignore
        pm = await WhitelistPaymaster.new()
        await pm.setRelayHub(relayHubAddress)
        await web3.eth.sendTransaction({from, to: pm.address, value: 1e18})

        console.log('pm', pm.address)
        console.log('s',s.address)
        console.log('s1',s1.address)
        gsnConfig = {
            relayHubAddress,
            stakeManagerAddress,
            paymasterAddress: pm.address
        };
        const p = new RelayProvider(web3.currentProvider, gsnConfig)
        SampleRecipient.web3.setProvider(p)
    })

    it('should allow a call without any whitelist', async () => {
        await s.something()
    })

    describe('with whitelisted sender', () => {
        before(async () => {
            await pm.whitelistSender(from)
        })
        it('should allow whitelisted sender', async () => {
            await s.something()
        })
        it('should prevent non-whitelisted sender', async () => {
            await expectRevert( s.something({from:another }), 'sender not whitelisted' )
        })
    })
    describe('with whitelisted target', () => {
        before(async () => {
            await pm.whitelistTarget(s1.address)
        })
        it('should allow whitelisted target', async () => {
            await s1.something()
        })
        it('should prevent non-whitelisted target', async () => {
            await expectRevert( s.something(), 'target not whitelisted' )
        })
    })
})
