import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';

import _ from 'lodash';
import moment from 'moment';
import SimpleSchema from 'simpl-schema';

import { promisifyCollection } from '../utils';

const { Integer } = SimpleSchema;

export const EstimateType = {
    backlog: "backlog",
    workPattern: "workPattern"
};

export const StartType = {
    immediately: "immediately",
    fixedDate: "fixedDate",
    after: "after",
    with: "with"
};

export const ThroughputType = {
    samples: "throughputSamples",
    estimate: "throughputEstimate",
    none: "none"
};

export const ErrorTypes = {
    shouldBeSmaller: "shouldBeSmaller",
    shouldBeGreater: "shouldBeGreater"
}

SimpleSchema.setDefaultMessages({
    messages: {
        en: {
            [ErrorTypes.shouldBeSmaller]: "{{{label}}} must be less than the high guess",
            [ErrorTypes.shouldBeGreater]: "{{{label}}} must be greater than the low guess",
        },
    },
});

export const Backlog = new SimpleSchema({

    // backlog size

    "lowGuess": { type: Integer, min: 0, custom: function() {
        if(this.value > this.siblingField('highGuess').value) {
            return ErrorTypes.shouldBeSmaller;
        }
    } },

    "highGuess": { type: Integer, min: 0, custom: function() {
        if(this.value < this.siblingField('lowGuess').value) {
            return ErrorTypes.shouldBeGreater;
        }
    } },
    
    // probability of a backlog item being split (e.g. 1.2 means 20% of the time, a work item is split into two work items)

    "lowSplitRate": { type: Number, min: 1, custom: function() {
        if(this.value > this.siblingField('highSplitRate').value) {
            return ErrorTypes.shouldBeSmaller;
        }
    } },

    "highSplitRate": { type: Number, min: 1, custom: function() {
        if(this.value < this.siblingField('lowSplitRate').value) {
            return ErrorTypes.shouldBeGreater;
        }
    } },

    // possible risks that could increase scope

    "risks": { type: Array, optional: true },
    
    "risks.$": Object,
    "risks.$.name": String,
    "risks.$.description": { type: String, optional: true },
    "risks.$.likelihood": { type: Number, min: 0, max: 1},

    "risks.$.lowImpact": { type: Integer, min: 0, custom: function() {
        if(this.value > this.siblingField('highImpact').value) {
            return ErrorTypes.shouldBeSmaller;
        }
    } },

    "risks.$.highImpact": { type: Integer, min: 0, custom: function() {
        if(this.value < this.siblingField('lowImpact').value) {
            return ErrorTypes.shouldBeGreater;
        }
    } },

});

export const Team = new SimpleSchema({

    // who is on the team?
    
    "members": { type: Array, optional: true },
    "members.$": Object,
    "members.$.role": String,
    "members.$.description": { type: String, optional: true },
    "members.$.quantity": { type: Number, min: 0 },

    // how is throughput forecast (estimate, samples or none)
    
    "throughputType": { type: String, optional: true, allowedValues: Object.values(ThroughputType) },

    // team's historical throughput (start date of period, number of items in period)
    
    "throughputSamples": { type: Array, optional: true, custom: function() {
        if((!this.value || this.value.length === 0) && this.siblingField('throughputType').value === ThroughputType.samples) {
            return SimpleSchema.ErrorTypes.REQUIRED;
        }
    } },

    "throughputSamples.$": Object,
    "throughputSamples.$.periodStartDate": Date,
    "throughputSamples.$.description": { type: String, optional: true },
    "throughputSamples.$.throughput": Integer,

    // guess of team's throughput (work items per period)

    "throughputEstimate": { type: Object, optional: true, custom: function() {
        if(!this.value && this.siblingField('throughputType').value === ThroughputType.estimate) {
            return SimpleSchema.ErrorTypes.REQUIRED;
        }
    } },

    "throughputEstimate.lowGuess": { type: Integer, min: 0, custom: function() {
        if(this.value > this.siblingField('highGuess').value) {
            return ErrorTypes.shouldBeSmaller;
        }
    } },

    "throughputEstimate.highGuess": { type: Integer, min: 0, custom: function() {
        if(this.value > this.siblingField('highGuess').value) {
            return ErrorTypes.shouldBeGreater;
        }
    } },

    // S-curve scaling (applied during beginning of both sample and guess based throughput)
    
    "rampUp": { type: Object, optional: true },
    "rampUp.duration": { type: Number, min: 0 },

    "rampUp.throughputScalingLowGuess": { type: Number, min: 0, max: 1, custom: function() {
        if(this.value > this.siblingField('throughputScalingHighGuess').value) {
            return ErrorTypes.shouldBeSmaller;
        }
    } },

    "rampUp.throughputScalingHighGuess": { type: Number, min: 0, max: 1, custom: function() {
        if(this.value < this.siblingField('throughputScalingLowGuess').value) {
            return ErrorTypes.shouldBeGreater;
        }
    } },

    // team's work pattern
    
    "workPattern": { type: Array, optional: true, custom: function() {
        if(!this.value && this.siblingField('throughputType').value === ThroughputType.none) {
            return SimpleSchema.ErrorTypes.REQUIRED;
        }
    } },

    "workPattern.$": Object,
    "workPattern.$.startDate": Date,
    "workPattern.$.endDate": Date,
    "workPattern.$.description": { type: String, optional: true }

});


export const Solution = new SimpleSchema({

    "_id": String,
    "name": { type: String, min: 1 },
    "description": { type: String, optional: true },
    "notes": { type: String, optional: true },

    // how do we estimate? 
    "estimateType": { type: String, allowedValues: Object.values(EstimateType) },

    // how long is a period (weeks)
    "throughputPeriodLength": { type: Integer, optional: true, min: 1, custom: function() {
        if(!this.value && this.siblingField('estimateType').value === EstimateType.backlog) {
            return SimpleSchema.ErrorTypes.REQUIRED;
        }
    } },

    // when does work on the solution start?
    "startType": { type: String, allowedValues: Object.values(StartType) },

    "startDate": { type: Date, optional: true, custom: function() {
        if(!this.value && this.siblingField('startType').value === StartType.fixedDate) {
            return SimpleSchema.ErrorTypes.REQUIRED;
        }
    } },

    "startDependency": { type: String, optional: true, custom: function() {
        if(!this.value && (this.siblingField('startType').value === StartType.with || this.siblingField('startType').value === StartType.after)) {
            return SimpleSchema.ErrorTypes.REQUIRED;
        }
    } },

    // what is the backlog (used if `estimateType` is `backlog`)
    "backlog": { type: Backlog, optional: true, custom: function() {
        if(!this.value && this.siblingField('estimateType').value === EstimateType.backlog) {
            return SimpleSchema.ErrorTypes.REQUIRED;
        }
    } },

    // what is the team?
    "team": Team
    
});

export const Project = new SimpleSchema({
    "_id": String,

    // security
    "owner": String,
    "readOnlyShares": [String],
    "readWriteShares": [String],

    // basic metadata
    "name": String,
    "description": { type: String, optional: true },
    "startDate": Date,

    // list of solutions
    "solutions": [Solution]
});

/**
 * Create a new minimal project object
 */
export function newProject({ name, owner, ...rest }) {
    return Project.clean(_.assignIn({
        _id: Random.id(),
        owner,
        readOnlyShares: [],
        readWriteShares: [],

        name,
        description: null,
        startDate: moment.utc().startOf('day').toDate(),
        solutions: []
    }, rest));
}

/**
 * Create a new minimal solution object
 */
export function newSolution({ name, ...rest }) {
    return Solution.clean({
        _id: Random.id(),
        name,
        description: null,
        notes: null,

        estimateType: EstimateType.backlog,
        throughputPeriodLength: 1,
        
        startType: StartType.immediately,
        startDate: null,
        startDependency: null,
        
        backlog: {
            lowGuess: 0,
            highGuess: 0,
            lowSplitRate: 1,
            highSplitRate: 1   
        },

        risks: [],
        
        team: {
            members: [],
            throughputType: ThroughputType.estimate,
            throughputSamples: [],
            throughputEstimate: {
                lowGuess: 0,
                highGuess: 0
            },
            rampUp: null,
            workPattern: []
        },

        ...rest
    });
}

export const Projects = new Mongo.Collection("Projects");
Projects.attachSchema(Project);

Projects.allow({

    insert(userId, doc) {
        return userId && doc.owner === userId;
    },

    update(userId, doc, fields, modifier) {
        return userId && (userId === doc.owner || _.includes(doc.readWriteShares, userId)) && !_.includes(fields, 'owner');
    },

    remove(userId, doc) {
        return userId && doc.owner === userId;
    },

    fetch: ['owner', 'readWriteShares']

});

export default promisifyCollection(Projects);

export function checkProjectOwnership(userId, projectId, canWrite) {
    if (!userId) {
        return false;
    }

    const project = Projects.findOne(projectId);
    if (!project) {
        return false;
    }

    return (
        project.owner === userId ||
        (!canWrite && _.includes(project.readOnlyShares, userId)) ||
        _.includes(project.readWriteShares, userId)
    );
}


if (Meteor.isServer) {

    Meteor.publish('projects', function () {
        if (!this.userId) {
            this.error(new Meteor.Error(401, 'Unauthorized'));
        } else {
            return Projects.find({
                $or: [
                    { owner: this.userId },
                    { readOnlyShares: this.userId },
                    { readWriteShares: this.userId }
                ]
            });
        }
    });
    
}
